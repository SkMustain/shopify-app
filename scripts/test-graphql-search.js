import '@shopify/shopify-api/adapters/node';
import { shopifyApi, ApiVersion } from '@shopify/shopify-api';
import { PrismaClient } from '@prisma/client';
import "dotenv/config";

const shopify = shopifyApi({
  apiSecretKey: 'test',
  apiKey: 'test',
  adminApiAccessToken: process.env.SHOPIFY_API_KEY,
  isEmbeddedApp: false,
  hostName: 'localhost',
  apiVersion: ApiVersion.October23
});

async function runTest() {
  const prisma = new PrismaClient();
  const session = await prisma.session.findFirst({
    where: { shop: { contains: 'myshopify.com' } }
  });

  if (!session) {
    console.log("No store session found in DB.");
    return;
  }

  console.log("Using store session:", session.shop);
  const client = new shopify.clients.Graphql({ session });

  try {
    const colName = 'Nature & Landscapes';
    console.log(`Searching for collection EXACT: '${colName}'...`);

    // Step 1: Get all collections
    const r1 = await client.request(`
      query { collections(first: 100) { edges { node { id, title } } } }
    `);

    const allCols = r1.data.collections.edges;
    const exactMatch = allCols.find(e => e.node.title.trim().toLowerCase() === colName.toLowerCase());

    if (exactMatch) {
      console.log("Found ID:", exactMatch.node.id);
      const r2 = await client.request(`
          query {
            collection(id: "${exactMatch.node.id}") {
              products(first: 5) { edges { node { title } } }
            }
          }
       `);
      console.log("Products:", JSON.stringify(r2.data, null, 2));
    } else {
      console.log("NOT FOUND IN", allCols.map(a => a.node.title));
    }
  } catch (e) {
    console.error("Error fetching collection:", e.message);
  }
}

runTest();
