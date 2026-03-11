import "dotenv/config";

const SHOP = process.env.SHOPIFY_STORE_URL || "suraj-test-v2.myshopify.com";
const TOKEN = process.env.SHOPIFY_API_KEY;

async function graphql(query, variables = {}) {
  const res = await fetch(`https://${SHOP}/admin/api/2023-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN
    },
    body: JSON.stringify({ query, variables })
  });
  return res.json();
}

async function runTest() {
  try {
    const textQuery = 'tag:Vastu-East';
    console.log(`Searching for products with query: "${textQuery}"`);

    const r1 = await graphql(`
      query {
        products(first: 5, query: "tag:Vastu-East") {
          edges { node { id, title, tags } }
        }
      }
    `);

    if (r1.errors) {
      console.error("Product fetch errors:", r1.errors);
      return;
    }
    const prods = r1.data?.products?.edges || [];
    console.log("Products found:", prods.length);
    console.log(JSON.stringify(prods, null, 2));
  } catch (e) {
    console.error("Error:", e.message || e);
  }
}

runTest();
