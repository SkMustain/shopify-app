import { GoogleGenerativeAI } from "@google/generative-ai";
import prisma from "../db.server.js";

export const ProductSyncService = {

    /**
     * Synchronizes and vectorizes all Shopify products.
     * Generates a 768-dimension vector using text-embedding-004.
     */
    async syncAll(admin, apiKey) {
        if (!admin || !apiKey) {
            console.warn("⚠️ Cannot sync catalog: Admin session or API Key is missing.");
            return { status: "ignored", message: "Missing admin or API key." };
        }

        console.log("🔄 Starting Shopify Product Sync & Vectorization...");
        
        try {
            // 1. Fetch ALL products from Shopify Catalog using a paginated loop
            let products = [];
            let hasNextPage = true;
            let cursor = null;

            while (hasNextPage) {
                console.log(`📡 Fetching products batch (cursor: ${cursor})...`);
                const response = await admin.graphql(`
                    query getProducts($cursor: String) {
                        products(first: 50, after: $cursor) {
                            pageInfo {
                                hasNextPage
                                endCursor
                            }
                            edges {
                                node {
                                    id
                                    title
                                    handle
                                    description(truncateAt: 1000)
                                    productType
                                    vendor
                                    tags
                                    collections(first: 10) {
                                        edges {
                                            node {
                                                title
                                            }
                                        }
                                    }
                                    metafields(first: 20) {
                                        edges {
                                            node {
                                                namespace
                                                key
                                                value
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                `, { variables: { cursor } });

                const json = await response.json();
                
                if (json.errors) {
                    console.error("GraphQL errors:", json.errors);
                    throw new Error("GraphQL Error: " + JSON.stringify(json.errors));
                }

                const batchProducts = json.data?.products?.edges.map(e => e.node) || [];
                products = products.concat(batchProducts);

                const pageInfo = json.data?.products?.pageInfo;
                hasNextPage = pageInfo?.hasNextPage || false;
                cursor = pageInfo?.endCursor || null;

                // Safety break to prevent infinite loops in massive catalogs
                if (products.length > 2000) {
                    console.warn("⚠️ Reached safety limit of 2000 products during sync.");
                    break;
                }
            }

            console.log(`📦 Fetched ${products.length} products total from Shopify. Starting embedding generation...`);

            const genAI = new GoogleGenerativeAI(apiKey);
            const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
            
            let updatedCount = 0;
            let skippedCount = 0;

            for (const p of products) {
                // Build a rich text snippet representing all collections this product belongs to
                let collectionsText = "";
                if (p.collections?.edges) {
                    const titles = p.collections.edges.map(e => e.node?.title).filter(Boolean);
                    if (titles.length > 0) {
                        collectionsText = ` | Collections: ${titles.join(", ")}`;
                    }
                }

                // Build a rich text snippet representing all available product metafields
                let metafieldsText = "";
                if (p.metafields?.edges) {
                    p.metafields.edges.forEach(edge => {
                        const m = edge.node;
                        if (m && m.value) {
                            metafieldsText += ` | Metafield ${m.namespace}.${m.key}: ${m.value}`;
                        }
                    });
                }

                // Construct the payload text that captures structural, emotional, Vastu, collections, and custom metafield details!
                const textPayload = `Title: ${p.title} | Type: ${p.productType || "Artwork"} | Vendor: ${p.vendor || "Art Assistant"} | Tags: ${(p.tags || []).join(", ")} | Description: ${p.description || ""}${collectionsText}${metafieldsText}`.trim();

                // Check if already vectorized and unchanged (optimization)
                const existing = await prisma.productEmbedding.findUnique({
                    where: { productId: p.id }
                });

                if (existing && existing.textPayload === textPayload) {
                    skippedCount++;
                    continue;
                }

                console.log(`🧬 Generating vector for: "${p.title}"`);
                
                try {
                    // Generate 768-dimension embedding vector
                    const result = await embedModel.embedContent(textPayload);
                    const embedding = result.embedding?.values;

                    if (!embedding || embedding.length === 0) {
                        throw new Error("Received empty embedding vector from Gemini.");
                    }

                    // Stringify embedding array to save as text in the database
                    const vectorString = JSON.stringify(embedding);

                    // Standard Prisma Upsert (database-agnostic, no pgvector or raw SQL required!)
                    await prisma.productEmbedding.upsert({
                        where: { productId: p.id },
                        update: {
                            embedding: vectorString,
                            textPayload: textPayload
                        },
                        create: {
                            productId: p.id,
                            embedding: vectorString,
                            textPayload: textPayload
                        }
                    });

                    updatedCount++;

                } catch (err) {
                    console.error(`❌ Failed to vectorize product "${p.title}":`, err.message);
                }
            }

            console.log(`✅ Sync Completed! Updated: ${updatedCount}, Skipped: ${skippedCount}`);
            return { 
                status: "success", 
                total: products.length, 
                updated: updatedCount, 
                skipped: skippedCount 
            };

        } catch (error) {
            console.error("❌ Critical error during product synchronization:", error);
            return { status: "error", error: error.message };
        }
    }
};
