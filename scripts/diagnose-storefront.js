import pkg from "@prisma/client";
const { PrismaClient } = pkg;
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const prisma = new PrismaClient();

async function run() {
    console.log("🔍 Running Storefront and Database Diagnosis...");

    // 1. Check Product Embeddings Count
    const count = await prisma.productEmbedding.count();
    console.log(`📊 Number of Product Embeddings in DB: ${count}`);

    if (count > 0) {
        const samples = await prisma.productEmbedding.findMany({ take: 3 });
        console.log("📝 Sample text payloads stored in DB:");
        samples.forEach((s, idx) => {
            console.log(`--- Sample #${idx+1} (ID: ${s.productId}) ---`);
            console.log(s.textPayload.slice(0, 300) + "...");
        });
    }

    // 2. Fetch Offline Shopify Access Token from Session Table
    const session = await prisma.session.findFirst({
        where: { isOnline: false }
    });

    if (!session) {
        console.error("❌ No offline session found in the database. Cannot query Shopify API.");
        return;
    }

    const { shop, accessToken } = session;
    console.log(`✅ Found Shopify Session for shop: ${shop}`);

    // 3. Query a sample product from Shopify to inspect metafields
    const graphqlUrl = `https://${shop}/admin/api/2026-04/graphql.json`;
    const headers = {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken
    };

    const query = {
        query: `
            query {
                products(first: 3) {
                    edges {
                        node {
                            id
                            title
                            metafields(first: 20) {
                                edges {
                                    node {
                                        namespace
                                        key
                                        value
                                        type
                                    }
                                }
                            }
                        }
                    }
                }
            }
        `
    };

    try {
        const response = await fetch(graphqlUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(query)
        });
        const resJson = await response.json();
        const products = resJson.data?.products?.edges.map(e => e.node) || [];
        
        console.log(`📦 Fetched ${products.length} products to check metafields.`);
        for (const p of products) {
            console.log(`Product: "${p.title}" (ID: ${p.id})`);
            console.log(`Metafields count: ${p.metafields?.edges?.length}`);
            p.metafields?.edges?.forEach(e => {
                const m = e.node;
                console.log(`  - Namespace: "${m.namespace}" | Key: "${m.key}" | Type: "${m.type}" | Value: "${m.value}"`);
            });
        }

    } catch (err) {
        console.error("❌ Failed to query Shopify GraphQL API:", err.message);
    } finally {
        await prisma.$disconnect();
    }
}

run();
