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
            // 1. Fetch products from Shopify Catalog
            const response = await admin.graphql(`
                query {
                    products(first: 100) {
                        edges {
                            node {
                                id
                                title
                                handle
                                description(truncateAt: 1000)
                                productType
                                vendor
                                tags
                            }
                        }
                    }
                }
            `);
            const json = await response.json();
            const products = json.data?.products?.edges.map(e => e.node) || [];
            
            console.log(`📦 Fetched ${products.length} products from Shopify. Starting embedding generation...`);

            const genAI = new GoogleGenerativeAI(apiKey);
            const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
            
            let updatedCount = 0;
            let skippedCount = 0;

            for (const p of products) {
                // Construct the payload text that captures structural & emotional vibe
                const textPayload = `Title: ${p.title} | Type: ${p.productType || "Artwork"} | Vendor: ${p.vendor || "Art Assistant"} | Tags: ${(p.tags || []).join(", ")} | Description: ${p.description || ""}`.trim();

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
