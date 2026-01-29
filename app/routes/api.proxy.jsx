import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
    // App Proxy requests receive a signature that must be validated
    // authenticate.public.appProxy handles this validation automatically
    const { session, cors } = await authenticate.public.appProxy(request);

    if (!session) {
        return new Response("Unauthorized", { status: 401 });
    }

    return Response.json({ status: "ok", message: "Hello from the Art Assistant API!" }, { headers: cors?.headers || {} });
};

export const action = async ({ request }) => {
    try {
        const { session, admin, cors } = await authenticate.public.appProxy(request);

        if (!session) {
            // Return 200 with error to bypass Shopify's 500 error page
            return Response.json({ reply: "Error: Unauthorized (Session invalid)" }, { headers: cors?.headers || {} });
        }

        const payload = await request.json();
        const userMessage = (payload.message || "").toLowerCase();
        const userImage = payload.image;

        let responseData = { reply: "I can help you find art. Try asking for 'Vastu' or 'Bedroom' advice." };

        // 1. Handle Visual Search (Mocked for now as we don't have Vision API yet)
        if (userImage) {
            responseData = {
                reply: "That looks like a beautiful room! Based on the colors, I recommend these modern abstract pieces (Mockup):",
                type: "carousel",
                data: [
                    { title: "Abstract Blue", price: "$150", image: "https://placehold.co/600x400/2980b9/ffffff?text=Abstract+Blue" },
                    { title: "Golden Horizon", price: "$220", image: "https://placehold.co/600x400/f1c40f/ffffff?text=Golden+Horizon" }
                ]
            };
        }
        // 2. Handle Help/Actions
        else if (userMessage.includes("help") || userMessage.includes("choose")) {
            responseData = {
                reply: "I can guide you. What kind of vibe are you looking for?",
                type: "actions",
                data: [
                    { label: "Peaceful & Calm", payload: "Show me peaceful art" },
                    { label: "Energetic & Bold", payload: "Show me bold abstract art" },
                    { label: "Traditional", payload: "Show me traditional art" }
                ]
            };
        }
        // 3. Handle Text Search (Real Shopify Data)
        else {
            // Default search query if message is too short
            const searchQuery = userMessage.length > 2 ? userMessage : "art";
            console.log("Searching Shopify for:", searchQuery);

            const response = await admin.graphql(
                `#graphql
                query ($query: String!) {
                  products(first: 5, query: $query) {
                    edges {
                      node {
                        id
                        title
                        handle
                        priceRangeV2 {
                          minVariantPrice {
                            amount
                            currencyCode
                          }
                        }
                        featuredImage {
                          url
                        }
                      }
                    }
                  }
                }`,
                { variables: { query: searchQuery } }
            );

            const responseJson = await response.json();
            const products = responseJson.data?.products?.edges || [];

            if (products.length > 0) {
                const carouselData = products.map(edge => {
                    const p = edge.node;
                    return {
                        title: p.title,
                        price: `${p.priceRangeV2.minVariantPrice.amount} ${p.priceRangeV2.minVariantPrice.currencyCode}`,
                        image: p.featuredImage?.url || "https://placehold.co/600x400?text=No+Image",
                        // Construct URL: Store domain is usually available in session or we can use relative path if on proxy
                        url: `/products/${p.handle}`
                    };
                });

                responseData = {
                    reply: `Found ${products.length} products for "${searchQuery}":`,
                    type: "carousel",
                    data: carouselData
                };
            } else {
                responseData = {
                    reply: `I couldn't find any products matching "${searchQuery}". Try "abstract", "nature", or "blue".`
                };
            }
        }

        return Response.json(responseData, { headers: cors?.headers || {} });

    } catch (error) {
        console.error("Proxy Error:", error);
        // CRITICAL: Return 200 so Shopify displays this JSON instead of the 500 HTML page
        return Response.json({
            reply: `Debug Error: ${error.message} \nStack: ${error.stack}`
        }, { status: 200 });
    }
};
