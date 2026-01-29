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

    // Import Prisma (ensure db.server.js exists/exports it)
    const { default: prisma } = await import("../db.server");

    // Fetch Vastu Config (with defaults)
    const vastuConfig = await prisma.vastuConfig.findMany();
    const getConfig = (dir) => vastuConfig.find(c => c.direction === dir) || {
      recommendation: dir === "North" || dir === "East" ? "Waterfalls or Nature (Growth)" :
        dir === "South" ? "running horses or fire themes (Success)" :
          "mountains or birds (Stability)",
      keywords: dir === "North" || dir === "East" ? "waterfall landscape nature" :
        dir === "South" ? "running horses fire abstract red" :
          "mountains birds landscape"
    };

    let responseData = { reply: "I can help you find art. Try asking for 'Vastu' or 'Bedroom' advice." };
    let shouldSearch = false; // Flag to determine if we run the GQL query
    let searchQuery = "";
    let replyPrefix = ""; // To prepend to the carousel intro

    // 1. VISUAL SEARCH
    if (userImage) {
      let analysisResult = "";

      // Try fetching API Key
      const apiKeySetting = await prisma.appSetting.findUnique({ where: { key: "GEMINI_API_KEY" } });

      if (apiKeySetting && apiKeySetting.value) {
        try {
          const { GoogleGenerativeAI } = await import("@google/generative-ai");
          const genAI = new GoogleGenerativeAI(apiKeySetting.value);

          // Helper to try models in sequence
          const generateWithFallback = async (prompt, imagePart) => {
            // Try specific versions first, then aliases
            const modelsToTry = ["gemini-1.5-flash-001", "gemini-1.5-flash", "gemini-1.5-pro-001", "gemini-pro-vision"];
            let errorLog = [];

            for (const modelName of modelsToTry) {
              try {
                console.log(`Attempting Gemini Model: ${modelName}`);
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent([prompt, imagePart]);
                return { result, modelName };
              } catch (e) {
                console.error(`Model ${modelName} failed:`, e.message);
                errorLog.push(`${modelName}: ${e.message}`);
              }
            }

            // If all failed, try to list available models to debug
            try {
              const listResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKeySetting.value}`);
              const listJson = await listResp.json();
              if (listJson.models) {
                const availableModels = listJson.models.map(m => m.name).join(", ");
                errorLog.push(`AVAILABLE MODELS: ${availableModels}`);
              } else {
                errorLog.push(`LIST MODELS FAILED: ${JSON.stringify(listJson)}`);
              }
            } catch (listErr) {
              errorLog.push(`LIST FETCH ERROR: ${listErr.message}`);
            }

            throw new Error(errorLog.join(" | "));
          };

          // Prepare image (Base64 removal)
          const base64Data = userImage.split(',')[1];
          const imagePart = {
            inlineData: { data: base64Data, mimeType: "image/jpeg" },
          };

          const prompt = "Analyze this room's interior design style and color palette. Return a JSON object with keys: 'style' (e.g. Modern, Boho), 'colors' (e.g. Blue, Earthy), and 'searchQuery' (a 2-3 word Shopify search term like 'Modern Art' or 'Boho Wall Decor'). Do not use markdown.";

          const { result, modelName } = await generateWithFallback(prompt, imagePart);

          const text = result.response.text();
          const cleanText = text.replace(/```json|```/g, '').trim();
          const json = JSON.parse(cleanText);

          searchQuery = json.searchQuery || "Abstract Art";
          replyPrefix = `I analyzed your room using Gemini Vision (${modelName})! I see **${json.style}** style with **${json.colors}** tones. Matches:`;
          analysisResult = `Real Analysis: ${json.style} / ${json.colors}`;
          shouldSearch = true;

        } catch (e) {
          console.error("Gemini Error:", e);
          searchQuery = "Modern Art";
          replyPrefix = `I had trouble using the AI Vision. Error: ${e.message || e.toString()}. Here are some modern picks instead:`;
          analysisResult = "Error: " + e.message;
          shouldSearch = true;
        }
      } else {
        // FALLBACK MOCK
        const styles = ["Abstract", "Landscape", "Nature", "Modern"];
        const colors = ["Blue", "Gold", "Red", "Green"];
        const detectedStyle = styles[Math.floor(Math.random() * styles.length)];
        const detectedColor = colors[Math.floor(Math.random() * colors.length)];

        searchQuery = `${detectedStyle} Art`;
        replyPrefix = `I analyzed the composition (Mock). The room has **${detectedStyle}** elements with **${detectedColor}** undertones.`;
        analysisResult = `Mock Analysis: ${detectedStyle}`;
        shouldSearch = true;
      }

      await prisma.customerImage.create({
        data: {
          imageData: userImage.substring(0, 100) + "...",
          analysisResult: analysisResult
        }
      });

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
      let direction = "";
      if (userMessage.includes("north") || userMessage.includes("east")) direction = "North";
      else if (userMessage.includes("south")) direction = "South";
      else if (userMessage.includes("west") || userMessage.includes("stability")) direction = "West";

      if (direction) {
        const conf = getConfig(direction);
        replyPrefix = `For ${direction} walls, I recommend ${conf.recommendation}.`;
        searchQuery = conf.keywords;
        shouldSearch = true;

        // Analytics Log
        await prisma.vastuLog.create({
          data: { direction, query: searchQuery }
        });
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
