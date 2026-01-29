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
    let shouldSearch = false; // Flag to determine if we run the GQL query
    let searchQuery = "";
    let replyPrefix = ""; // To prepend to the carousel intro

    // 1. VISUAL SEARCH (Mocked)
    if (userImage) {
      const styles = ["Modern", "Traditional", "Minimalist"];
      const colors = ["Blue", "Warm", "Monochrome"];
      const detectedStyle = styles[Math.floor(Math.random() * styles.length)];
      const detectedColor = colors[Math.floor(Math.random() * colors.length)];

      searchQuery = `${detectedStyle} ${detectedColor} Abstract`;
      replyPrefix = `I analyzed your room! I see a **${detectedStyle}** style with **${detectedColor}** tones.`;
      shouldSearch = true;
    }

    // 2. HELP / ACTIONS
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
      // Return immediately for simple actions
      return Response.json(responseData, { headers: cors?.headers || {} });
    }

    // 3. VASTU LOGIC
    else if (userMessage.includes("vastu")) {
      if (userMessage.includes("north") || userMessage.includes("east")) {
        replyPrefix = "For North/East walls, I recommend Waterfalls or Nature (Growth).";
        searchQuery = "waterfall landscape nature";
        shouldSearch = true;
      } else if (userMessage.includes("south")) {
        replyPrefix = "For South walls, running horses or fire themes bring Success.";
        searchQuery = "running horses fire abstract red";
        shouldSearch = true;
      } else if (userMessage.includes("west") || userMessage.includes("stability")) {
        replyPrefix = "For South-West, mountains or birds symbolize Stability.";
        searchQuery = "mountains birds landscape";
        shouldSearch = true;
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

    // 4. STANDARD TEXT SEARCH (If not handled above)
    else {
      searchQuery = userMessage;
      shouldSearch = true;
    }

    // --- SEARCH EXECUTION ---
    if (shouldSearch) {
      // Clean Query if it wasn't set by Vastu/Vision (i.e. if it came from raw user input)
      if (!userImage && !userMessage.includes("vastu")) {
        const stopWords = [
          "show", "me", "find", "looking", "for", "some", "art", "paintings", "compliant",
          "guide", "help", "choose", "products", "i", "want", "my", "need", "like", "suggestion",
          "advice", "room", "wall", "decor"
        ];
        if (searchQuery.split(" ").length > 1) {
          searchQuery = searchQuery.split(" ")
            .filter(word => !stopWords.includes(word.toLowerCase()))
            .join(" ")
            .trim();
        }
        if (searchQuery.length < 2) searchQuery = "art";
      }

      console.log("Executing Search for:", searchQuery);

      const response = await admin.graphql(
        `#graphql
        query ($query: String!) {
          products(first: 5, query: $query) {
            edges {
              node {
                title
                handle
                description(truncateAt: 60)
                priceRangeV2 { minVariantPrice { amount currencyCode } }
                featuredImage { url }
              }
            }
          }
        }`,
        { variables: { query: searchQuery } }
      );

      const responseJson = await response.json();
      let products = responseJson.data?.products?.edges || [];

      // Default intro if not set by logic above
      if (!replyPrefix) replyPrefix = `Found ${products.length} products for "${searchQuery}":`;

      // ZERO RESULT FALLBACK
      if (products.length === 0) {
        console.log("No exact matches. Fetching fallback products.");
        const fallbackResponse = await admin.graphql(
          `#graphql
          query {
            products(first: 5, sortKey: CREATED_AT, reverse: true) {
              edges {
                node {
                  title
                  handle
                  description(truncateAt: 60)
                  priceRangeV2 { minVariantPrice { amount currencyCode } }
                  featuredImage { url }
                }
              }
            }
          }`
        );
        const fallbackJson = await fallbackResponse.json();
        products = fallbackJson.data?.products?.edges || [];
        replyPrefix = `I couldn't find exact matches for "${searchQuery}", but here are some popular pieces you might love:`;
      }

      if (products.length > 0) {
        const carouselData = products.map(edge => ({
          title: edge.node.title,
          price: `${edge.node.priceRangeV2.minVariantPrice.amount} ${edge.node.priceRangeV2.minVariantPrice.currencyCode}`,
          image: edge.node.featuredImage?.url || "https://placehold.co/600x400?text=No+Image",
          url: `/products/${edge.node.handle}`
        }));

        responseData = {
          reply: replyPrefix, // Use the dynamic prefix
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
