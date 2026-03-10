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
    orderBy: { shop: 'desc' }
  });

  if (!session) {
    console.log("No store session found in DB.");
    return;
  }

  console.log("Using store session:", session.shop);
  const client = new shopify.clients.Graphql({ session });

  try {
    const q = 'tag:Vastu-North';
    console.log(`Searching for: products(query: "${q}")`);

    const r1 = await client.request(`
      query {
        products(first: 20, query: "${q}") {
          edges { node { id, title, tags } }
        }
      }
    `);

    const prods = r1.data.products.edges;
    console.log("Products found:", prods.length);
    if (prods.length > 0) {
      console.log(JSON.stringify(prods, null, 2));
    }
  } catch (e) {
    console.error("Error fetching products:", e.message);
  }
}

runTest();
