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
      keywords: dir === "waterfall landscape nature" // fallback keywords
    };

    let responseData = { reply: "I can help you find art. Try asking for 'Vastu' or 'Bedroom' advice." };
    let shouldSearch = false; // Flag to determine if we run the GQL query

    // Core Signals for Expert Analysis
    let searchQueries = []; // Array of broad queries
    let designCritique = ""; // Expert analysis text
    let userContext = ""; // For curation prompt
    let analysisLog = ""; // For DB logging

    // 1. VISUAL SEARCH (EXPERT MODE)
    if (userImage) {
      // Try fetching API Key
      const apiKeySetting = await prisma.appSetting.findUnique({ where: { key: "GEMINI_API_KEY" } });

      if (apiKeySetting && apiKeySetting.value) {
        try {
          const { GoogleGenerativeAI } = await import("@google/generative-ai");
          const genAI = new GoogleGenerativeAI(apiKeySetting.value);

          // Helper to try models in sequence
          const generateWithFallback = async (prompt, imagePart) => {
            const modelsToTry = ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-flash-latest"];
            let errorLog = [];

            for (const modelName of modelsToTry) {
              try {
                console.log(`Attempting Gemini Model (Vision): ${modelName}`);
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

          // Prepare image
          const base64Data = userImage.split(',')[1];
          const imagePart = {
            inlineData: { data: base64Data, mimeType: "image/jpeg" },
          };

          const prompt = `Act as an Expert Interior Designer. Analyze this room's interior design style, color palette, and mood.
          Identify what kind of wall art would elevate the space (e.g. adding warmth to a cold room, or a focal point).
          
          Return a JSON object with keys: 
          'critique': "A 2-sentence expert critique identifying the style and what the room needs.",
          'searchQueries': (A JSON ARRAY of 3 SIMPLE, HIGH-RECALL Shopify search terms. e.g. ["Abstract", "Beige Art", "Canvas"]. Do NOT use complex phrases like "Transitional decor". Keep it simple to find products.),
          'style': "Short style name (e.g. Minimalist)"

          Return ONLY the JSON string.`;

          const { result, modelName } = await generateWithFallback(prompt, imagePart);
          const text = result.response.text();
          console.log("Raw Gemini Output (Vision):", text);

          // JSON Extraction
          const start = text.indexOf('{');
          const end = text.lastIndexOf('}');
          if (start !== -1 && end !== -1) {
            const json = JSON.parse(text.substring(start, end + 1));

            designCritique = json.critique || "I analyzed your room's style.";
            searchQueries = json.searchQueries || ["Art"];
            analysisLog = `Style: ${json.style}. Critique: ${designCritique}`;

            // Set context for the Curator later
            userContext = `Visual Analysis: ${designCritique}. User's Message: ${userMessage}`;
            shouldSearch = true;
          } else {
            throw new Error("Invalid JSON from Vision");
          }

        } catch (e) {
          console.error("Gemini Vision Error:", e);
          searchQueries = ["Modern Art", "Abstract"];
          designCritique = "I had trouble analyzing the image deeply, but I've picked some modern pieces for you.";
          shouldSearch = true;
        }
      } else {
        // MOCK FALLBACK
        searchQueries = ["Abstract Art"];
        designCritique = "(Mock) Your room has a lovely modern vibe. A bold abstract piece would look great here.";
        shouldSearch = true;
      }

      await prisma.customerImage.create({
        data: {
          imageData: userImage.substring(0, 100) + "...",
          analysisResult: analysisLog || "Error/Mock"
        }
      });
    }

    // 2. TEXT SEARCH / VASTU / ACTIONS
    else if (userMessage.includes("help") || userMessage.includes("choose")) {
      // ... (Simple actions logic remains the same)
      responseData = {
        reply: "I can guide you. What kind of vibe are you looking for?",
        type: "actions",
        data: [
          { label: "Peaceful & Calm", payload: "Show me peaceful art" },
          { label: "Energetic & Bold", payload: "Show me bold abstract art" },
          { label: "Traditional", payload: "Show me traditional art" }
        ]
      };
      return Response.json(responseData, { headers: cors?.headers || {} });
    }
    else if (userMessage.includes("vastu")) {
      // ... (Vastu logic remains similar but sets context)
      let direction = "";
      if (userMessage.includes("north") || userMessage.includes("east")) direction = "North";
      else if (userMessage.includes("south")) direction = "South";
      else if (userMessage.includes("west")) direction = "West";

      if (direction) {
        const conf = getConfig(direction);
        designCritique = `For ${direction}-facing walls, Vastu recommends ${conf.recommendation || "specific colors"}.`;
        searchQueries = (conf.keywords || "art").split(" ");
        userContext = `User wants Vastu compliant art for ${direction} wall.`;
        shouldSearch = true;
      } else {
        // Ask direction
        return Response.json({
          reply: "Vastu Shastra depends on direction. Which wall are you decorating?",
          type: "actions",
          data: [{ label: "North/East", payload: "Vastu North" }, { label: "South", payload: "Vastu South" }]
        }, { headers: cors?.headers || {} });
      }
    }
    else {
      // Standard Text
      userContext = userMessage;
      shouldSearch = true;
    }

    // --- EXPERT SEARCH EXECUTION ---
    if (shouldSearch) {

      // 1. QUERY GENERATION (If not done by Vision)
      const apiKeySetting = await prisma.appSetting.findUnique({ where: { key: "GEMINI_API_KEY" } });
      let genAI;
      let useAiCuration = false;

      if (apiKeySetting && apiKeySetting.value) {
        const { GoogleGenerativeAI } = await import("@google/generative-ai");
        genAI = new GoogleGenerativeAI(apiKeySetting.value);
        useAiCuration = true;

        if (searchQueries.length === 0) {
          try {
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            // Expert Prompt for Text
            const qPrompt = `Act as an Interior Designer. User says: "${userMessage}". 
                    1. Write a 1-sentence design interpretation (Critique).
                    2. Generate 3 SIMPLE, BROAD Shopify search terms to find candidates (e.g. "Blue Art", "Canvas").
                    Return JSON: { "critique": "...", "searchQueries": [...] }`;

            const result = await model.generateContent(qPrompt);
            const text = result.response.text();
            const jsonMatch = text.match(/\{.*\}/s); // loose match
            if (jsonMatch) {
              const json = JSON.parse(jsonMatch[0]);
              searchQueries = json.searchQueries || [userMessage];
              designCritique = json.critique || "";
              userContext = `User Request: ${userMessage}. Designer Note: ${designCritique}`;
            } else {
              searchQueries = [userMessage];
            }
          } catch (e) {
            console.error("Text Query Gen Error:", e);
            searchQueries = [userMessage];
          }
        }
      }

      if (searchQueries.length === 0) searchQueries = ["Art"];
      console.log("Broad Search Queries:", searchQueries);

      // 2. ROBUST POOLING
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

      const results = await Promise.all(searchQueries.map(q => fetchProducts(q)));

      const candidateMap = new Map();
      results.flat().forEach(edge => {
        if (!candidateMap.has(edge.node.handle)) {
          candidateMap.set(edge.node.handle, edge.node);
        }
      });
      let candidates = Array.from(candidateMap.values());
      console.log(`Initial Candidates: ${candidates.length}`);

      // ZERO RESULT POLICY: Fallback to "Art" if pool is too small
      if (candidates.length < 5) {
        console.log("Pool too small. triggering Fallback 'Art' search.");
        const fallback = await fetchProducts("Art"); // Broadest possible term
        fallback.forEach(edge => {
          if (!candidateMap.has(edge.node.handle)) {
            candidateMap.set(edge.node.handle, edge.node);
          }
        });
        candidates = Array.from(candidateMap.values());
      }

      // 3. EXPERT CURATION
      let finalProducts = [];
      let expertAdvice = "";

      if (useAiCuration && candidates.length > 0) {
        try {
          const pool = candidates.slice(0, 50).map(p => ({
            handle: p.handle,
            title: p.title,
            price: p.priceRangeV2.minVariantPrice.amount,
            desc: p.description
          }));

          const curationPrompt = `
                    You are an Expert Interior Designer.
                    Context: "${designCritique || userContext}"
                    
                    Task: Select the top 5 pieces from the list below that PERFECTLY elevate this space.
                    Explain your choice to the user in a friendly, expert tone.

                    Candidates: ${JSON.stringify(pool)}

                    Return JSON: { "selectedHandles": ["..."], "expertAdvice": "I chose these because..." }
                `;

          const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
          const result = await model.generateContent(curationPrompt);
          const text = result.response.text();

          const start = text.indexOf('{');
          const end = text.lastIndexOf('}');
          if (start !== -1 && end !== -1) {
            const json = JSON.parse(text.substring(start, end + 1));
            const selectedHandles = json.selectedHandles || [];
            expertAdvice = json.expertAdvice || "";

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

      // 4. RESPONSE
      if (finalProducts.length > 0) {
        // Priority: Design Critique -> Expert Advice -> Default
        let intro = "";
        if (designCritique) {
          intro += `${designCritique}\n\n`;
        }
        if (expertAdvice) {
          intro += `**Designer's Pick:** ${expertAdvice}`;
        } else {
          intro += "Here are the best matches for your space.";
        }

        // Cleanup
        replyPrefix = intro;

        const carouselData = finalProducts.map(node => ({
          title: node.title,
          price: `${node.priceRangeV2.minVariantPrice.amount} ${node.priceRangeV2.minVariantPrice.currencyCode}`,
          image: node.featuredImage?.url || "https://placehold.co/600x400?text=No+Image",
          url: `/products/${node.handle}`
        }));

        responseData = {
          reply: replyPrefix,
          type: "carousel",
          data: carouselData
        };
      } else {
        // Truly empty store?
        responseData = {
          reply: "I looked through the entire collection, but it seems empty! Please add some products to Shopify."
        };
      }
    }

    return Response.json(responseData, { headers: cors?.headers || {} });

  } catch (error) {
    console.error("Proxy Error:", error);
    return Response.json({
      reply: `Debug Error: ${error.message} \nStack: ${error.stack}`
    }, { status: 200 });
  }
};
