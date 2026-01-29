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

    // 1. Handle Visual Search (Mocked Vision API)
    if (userImage) {
      // Simulate Analysis (Randomly pick attributes)
      const styles = ["Modern", "Traditional", "Minimalist"];
      const colors = ["Blue", "Warm", "Monochrome"];
      const detectedStyle = styles[Math.floor(Math.random() * styles.length)];
      const detectedColor = colors[Math.floor(Math.random() * colors.length)];

      // Construct search query from analysis
      const visionQuery = `${detectedStyle} ${detectedColor} Abstract`;
      console.log(`Vision Analysis: ${detectedStyle} room with ${detectedColor} tones. Searching: ${visionQuery}`);

      // Perform Search
      const response = await admin.graphql(
        `#graphql
                query ($query: String!) {
                  products(first: 5, query: $query) {
                    edges {
                      node {
                        title
                        handle
                        priceRangeV2 { minVariantPrice { amount currencyCode } }
                        featuredImage { url }
                      }
                    }
                  }
                }`,
        { variables: { query: visionQuery } }
      );
      const responseJson = await response.json();
      const products = responseJson.data?.products?.edges || [];

      if (products.length > 0) {
        const carouselData = products.map(edge => ({
          title: edge.node.title,
          price: `${edge.node.priceRangeV2.minVariantPrice.amount} ${edge.node.priceRangeV2.minVariantPrice.currencyCode}`,
          image: edge.node.featuredImage?.url,
          url: `/products/${edge.node.handle}`
        }));
        responseData = {
          reply: `I analyzed your room! I see a **${detectedStyle}** style with **${detectedColor}** tones. Here are some matches:`,
          type: "carousel",
          data: carouselData
        };
      } else {
        responseData = { reply: `I see a ${detectedStyle} room, but couldn't find exact matches. Try searching for 'Abstract'.` };
      }
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
    // 2.1 Handle Vastu Logic
    else if (userMessage.includes("vastu")) {
      // Check if specific direction is mentioned
      if (userMessage.includes("north") || userMessage.includes("east")) {
        responseData = { reply: "For North/East walls, I recommend Waterfalls or Nature (Growth). Searching..." };
        // Let it fall through to search execution with specific query
        userMessage = "waterfall landscape nature";
      } else if (userMessage.includes("south")) {
        responseData = { reply: "For South walls, running horses or fire themes bring Success. Searching..." };
        userMessage = "running horses fire abstract red";
      } else if (userMessage.includes("west") || userMessage.includes("stability")) {
        responseData = { reply: "For South-West, mountains or birds symbolize Stability. Searching..." };
        userMessage = "mountains birds landscape";
      } else {
        // Ask for direction
        responseData = {
          reply: "Vastu Shastra depends on direction. Which wall are you decorating?",
          type: "actions",
          data: [
            { label: "North / East", payload: "Vastu North" },
            { label: "South", payload: "Vastu South" },
            { label: "South-West", payload: "Vastu West" }
          ]
        };
        return Response.json(responseData, { headers: cors?.headers || {} });
      }
    }
    // 3. Handle Text Search (Real Shopify Data)
    else {
      // Clean up the search query
      // Clean up the search query
      let searchQuery = userMessage;
      const stopWords = [
        "show", "me", "find", "looking", "for", "some", "art", "paintings", "compliant",
        "guide", "help", "choose", "products", "i", "want", "my", "need", "like", "suggestion",
        "advice", "room", "wall", "decor"
      ];

      // If the query is long (not just a keyword like "vastu"), try to extract keywords
      if (userMessage.split(" ").length > 1) {
        searchQuery = userMessage.split(" ")
          .filter(word => !stopWords.includes(word.toLowerCase()))
          .join(" ")
          .trim();
      }

      // Fallback if cleaning removed everything
      if (searchQuery.length < 2) searchQuery = "art";

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
                        description(truncateAt: 60)
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
      let products = responseJson.data?.products?.edges || [];
      let replyMessage = `Found ${products.length} products for "${searchQuery}":`;

      // ZERO RESULT FALLBACK
      if (products.length === 0) {
        console.log("No exact matches. Fetching fallback products.");
        const fallbackResponse = await admin.graphql(
          `#graphql
                    query {
                      products(first: 5, sortKey: CREATED_AT, reverse: true) {
                        edges {
                          node {
                            id
                            title
                            handle
                            description(truncateAt: 60)
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
                    }`
        );
        const fallbackJson = await fallbackResponse.json();
        products = fallbackJson.data?.products?.edges || [];
        replyMessage = `I couldn't find exact matches for "${searchQuery}", but here are some popular pieces you might love:`;
      }

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
          reply: replyMessage,
          type: "carousel",
          data: carouselData
        };
      } else {
        responseData = {
          reply: `I looked everywhere but couldn't find any products in your store. Try adding some products or searching for something else.`
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
