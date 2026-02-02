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

    // Core Signals
    let searchQueries = []; // Array of broad queries
    let primarySearchTerm = ""; // The main concept (for error display)
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
            // Updated to use the models explicitly listed by the user
            const modelsToTry = ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-flash-latest"];
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
            throw new Error(errorLog.join(" | "));
          };

          // Prepare image (Base64 removal)
          const base64Data = userImage.split(',')[1];
          const imagePart = {
            inlineData: { data: base64Data, mimeType: "image/jpeg" },
          };

          const prompt = `Analyze this room's interior design style and color palette. 
          Return a JSON object with keys: 
          'style' (e.g. Modern, Boho), 
          'colors' (e.g. Blue, Earthy), 
          'searchQueries' (A JSON ARRAY of 3 distinct, broad Shopify search terms. Example: ["Boho Wall Art", "Beige Decor", "Macrame"]).
          Return ONLY the JSON string, no markdown formatting.`;

          const { result, modelName } = await generateWithFallback(prompt, imagePart);

          const text = result.response.text();
          console.log("Raw Gemini Output:", text); // Debug log

          // Robust JSON extraction: Find first { and last }
          const start = text.indexOf('{');
          const end = text.lastIndexOf('}');

          let json;
          if (start !== -1 && end !== -1) {
            const jsonString = text.substring(start, end + 1);
            json = JSON.parse(jsonString);
          } else {
            throw new Error("Invalid JSON structure in response: " + text);
          }

          if (json.searchQueries && Array.isArray(json.searchQueries)) {
            searchQueries = json.searchQueries;
          } else if (json.searchQuery) { // Fallback for old prompt structure
            searchQueries = [json.searchQuery];
          } else {
            searchQueries = ["Abstract Art"];
          }

          primarySearchTerm = json.style ? `${json.style} Style` : searchQueries[0];

          replyPrefix = `I analyzed your room using Gemini Vision! I see **${json.style}** style with **${json.colors}** tones. Matches:`;
          analysisResult = `Real Analysis: ${json.style} / ${json.colors}`;
          shouldSearch = true;

        } catch (e) {
          console.error("Gemini Error:", e);
          searchQueries = ["Modern Art"];
          primarySearchTerm = "Modern Art";
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

        searchQueries = [`${detectedStyle} Art`];
        primarySearchTerm = `${detectedStyle} Art`;
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
        searchQueries = conf.keywords.split(' '); // simple split for vastu defaults
        if (searchQueries.length === 0) searchQueries = [conf.keywords];
        primarySearchTerm = `${direction} Vastu Art`;
        shouldSearch = true;

        // Analytics Log
        await prisma.vastuLog.create({
          data: { direction, query: conf.keywords } // log raw keywords
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
      primarySearchTerm = userMessage; // Initially set to user message
      shouldSearch = true;
    }

    // --- SEARCH EXECUTION (AI RECOMMENDATION ENGINE) ---
    if (shouldSearch) {
      console.log("Starting AI Recommendation Engine. Primary Term:", primarySearchTerm);

      let useAiCuration = false;
      const apiKeySetting = await prisma.appSetting.findUnique({ where: { key: "GEMINI_API_KEY" } });
      let genAI;

      if (apiKeySetting && apiKeySetting.value) {
        const { GoogleGenerativeAI } = await import("@google/generative-ai");
        genAI = new GoogleGenerativeAI(apiKeySetting.value);
        useAiCuration = true;

        // Generate Broad Queries IF NOT ALREADY SET by Image/Vastu
        if (searchQueries.length === 0) {
          try {
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const qPrompt = `User wants: "${userMessage}". Generate 3 distinct, broad Shopify search queries to find relevant products. Example: for "Boho Bedroom", return ["Boho Wall Art", "Beige Decor", "Macrame"]. Return ONLY a JSON array of strings.`;
            const result = await model.generateContent(qPrompt);
            const text = result.response.text();
            const jsonMatch = text.match(/\[.*\]/s);
            if (jsonMatch) {
              searchQueries = JSON.parse(jsonMatch[0]);
              console.log("Generated Broad Queries:", searchQueries);
            } else {
              searchQueries = [userMessage];
            }
          } catch (e) {
            console.error("Query Gen Error:", e);
            searchQueries = [userMessage];
          }
        }
      } else {
        // No API Key, fallback to single query or user message
        if (searchQueries.length === 0) searchQueries = [userMessage];
      }

      // Ensure we have something
      if (searchQueries.length === 0) searchQueries = ["Art"];

      // Execute Broad Searches in Parallel
      const fetchProducts = async (q) => {
        const response = await admin.graphql(
          `#graphql
          query ($query: String!) {
            products(first: 20, query: $query) {
              edges {
                node {
                  id
                  title
                  handle
                  description(truncateAt: 100)
                  priceRangeV2 { minVariantPrice { amount currencyCode } }
                  featuredImage { url }
                }
              }
            }
          }`,
          { variables: { query: q } }
        );
        const json = await response.json();
        return json.data?.products?.edges || [];
      };

      console.log("Fetching candidates for:", searchQueries);
      const results = await Promise.all(searchQueries.map(q => fetchProducts(q)));

      // Deduplicate Candidates by Handle
      const candidateMap = new Map();
      results.flat().forEach(edge => {
        if (!candidateMap.has(edge.node.handle)) {
          candidateMap.set(edge.node.handle, edge.node);
        }
      });
      let candidates = Array.from(candidateMap.values());
      console.log(`Fetched ${candidates.length} unique candidates.`);

      // 2. AI CURATION (Re-ranking)
      let finalProducts = [];
      let curationReason = "";

      if (useAiCuration && candidates.length > 0) {
        try {
          // Limit to top 50 to fit context context
          const pool = candidates.slice(0, 50).map(p => ({
            handle: p.handle,
            title: p.title,
            price: p.priceRangeV2.minVariantPrice.amount,
            desc: p.description
          }));

          // If we have an image, the userMessage might be "i want paintings" which is useless.
          // If image is present, prioritize the analysis Style/Colors in the prompt context.
          const userContext = userImage
            ? `Visual Style: ${primarySearchTerm}. User Note: ${userMessage}`
            : userMessage || primarySearchTerm;

          const curationPrompt = `
                User Context: "${userContext}"
                Task: Select the top 5 products from the list below that BEST fit the user's aesthetic usage. 
                Strictly ignore irrelevant items (e.g. ignore 'Industrial' if user wants 'Boho').
                
                Candidates: ${JSON.stringify(pool)}

                Return a JSON object: { "selectedHandles": ["handle1", "handle2"], "reason": "Single sentence explaining why these fit the vibe." }
            `;

          const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
          const result = await model.generateContent(curationPrompt);
          const text = result.response.text();

          const start = text.indexOf('{');
          const end = text.lastIndexOf('}');
          if (start !== -1 && end !== -1) {
            const json = JSON.parse(text.substring(start, end + 1));
            const selectedHandles = json.selectedHandles || [];
            curationReason = json.reason || "";

            // Map back to full product objects
            finalProducts = selectedHandles
              .map(h => candidateMap.get(h))
              .filter(Boolean);
          }
        } catch (e) {
          console.error("Curation Error:", e);
          finalProducts = candidates.slice(0, 5);
        }
      } else {
        finalProducts = candidates.slice(0, 5);
      }

      // Format for Frontend
      if (finalProducts.length > 0) {
        // Use AI reason if available
        if (curationReason) replyPrefix = `I found these perfect matches for you! ${curationReason}`;
        else if (!replyPrefix) replyPrefix = `Here are the top results for "${primarySearchTerm}":`;

        const carouselData = finalProducts.map(node => ({
          title: node.title,
          price: `${node.priceRangeV2.minVariantPrice.amount} ${node.priceRangeV2.minVariantPrice.currencyCode}`,
          image: node.featuredImage?.url || "https://placehold.co/600x400?text=No+Image",
          url: `/products/${node.handle}`
        }));

        responseData = {
          reply: replyPrefix, // Use the dynamic prefix
          type: "carousel",
          data: carouselData
        };
      } else {
        // Display the Primary Term (e.g. "Boho Style") instead of raw user text if it was an image search
        const displayTerm = userImage ? primarySearchTerm : (userMessage || primarySearchTerm);
        responseData = {
          reply: `I couldn't find any products matching "${displayTerm}" in your store.`
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
