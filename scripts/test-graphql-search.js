import { shopifyApi, LATEST_API_VERSION } from '@shopify/shopify-api';

const shopify = shopifyApi({
    apiSecretKey: 'test',
    apiKey: 'test',
    adminApiAccessToken: process.env.SHOPIFY_API_KEY,
    isEmbeddedApp: false,
    hostName: 'localhost',
    apiVersion: LATEST_API_VERSION
});

async function testSearch() {
    // Use the active shop offline session to hit GraphQL API directly
    // We need the shop domain and an access token from the DB.

    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();

    const session = await prisma.session.findFirst({
        where: { shop: { contains: 'myshopify.com' } }
    });

    if (!session) {
        console.log("No store session found in DB to test with.");
        return;
    }

    console.log("Testing with shop:", session.shop);

    const client = new shopify.clients.Graphql({
        session: session
    });

    const query = `
    query {
      products(first: 10, query: "") {
        edges {
          node {
            id
            title
            tags
            status
          }
        }
      }
    }
  `;

    try {
        const response = await client.request(query);
        console.log("Total products found with empty query (should be all ACTIVE):");
        console.log(JSON.stringify(response.data, null, 2));

        // Test the specific 'Nature Landscape' query we had generated
        const specificQuery = `
      query {
        products(first: 10, query: "(title:Nature* OR tag:Nature*) AND (title:Landscape* OR tag:Landscape*)") {
          edges {
            node {
              id
              title
              tags
            }
          }
        }
      }
    `;
        const res2 = await client.request(specificQuery);
        console.log("\\n\\nProducts matching the specific Generated query:");
        console.log(JSON.stringify(res2.data, null, 2));

    } catch (err) {
        console.error("GraphQL Error:", err);
    }
}

testSearch();
