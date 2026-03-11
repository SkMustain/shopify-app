import '@shopify/shopify-api/adapters/node';
import { shopifyApi, ApiVersion } from '@shopify/shopify-api';
import Prisma from '@prisma/client';
const { PrismaClient } = Prisma;

const shopify = shopifyApi({
  apiSecretKey: 'test',
  apiKey: 'test',
  isEmbeddedApp: false,
  hostName: 'localhost',
  apiVersion: ApiVersion.October23
});

async function runTest() {
  const prisma = new PrismaClient();
  const session = await prisma.session.findFirst({
    where: { isActive: true },
    orderBy: { shop: 'desc' }
  });

  if (!session) {
    console.log("No active session found.");
    return;
  }

  console.log("Using store session:", session.shop);
  const client = new shopify.clients.Graphql({ session });

  try {
    const q1 = await client.request(`
      query {
        products(first: 1) {
          edges {
            node {
              id title handle description(truncateAt: 100) productType vendor tags
              variants(first: 1) { edges { node { id, price } } }
              featuredImage { url } priceRangeV2 { minVariantPrice { amount currencyCode } }
            }
          }
        }
      }
    `);
    console.log("SUCCESS");
  } catch (e) {
    console.error("GRAPHQL ERROR:", e.message || e);
    if (e.response && e.response.errors) {
      console.error(JSON.stringify(e.response.errors, null, 2));
    }
  }
}

runTest();
