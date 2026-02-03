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
    let replyPrefix = ""; // To prepend to the carousel intro
    let desiredFormat = ""; // 'painting', 'poster', or ''

    // 1. VISUAL SEARCH (EXPERT MODE)
    if (userImage) {
      // ... (Existing Vision Logic)
      const apiKeySetting = await prisma.appSetting.findUnique({ where: { key: "GEMINI_API_KEY" } });

      if (apiKeySetting && apiKeySetting.value) {
        try {
          const { GoogleGenerativeAI } = await import("@google/generative-ai");
          const genAI = new GoogleGenerativeAI(apiKeySetting.value);

          // Helper to try models in sequence
          const generateWithFallback = async (prompt, imagePart) => {
            const modelsToTry = ["gemini-2.0-flash", "gemini-1.5-flash"];
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

    // 2. GUIDED SEARCH FLOW (WIZARD)
    else if (userMessage.includes("help") || userMessage.includes("choose") || userMessage.startsWith("flow_")) {

      // STEP 1: TRIGGER (or restart)
      if (userMessage.includes("help") || userMessage.includes("choose")) {
        return Response.json({
          reply: "I'd love to help you find the perfect piece! First, which room are you decorating?",
          type: "actions",
          data: [
            { label: "Living Room", payload: "flow_room:Living Room" },
            { label: "Bedroom", payload: "flow_room:Bedroom" },
            { label: "Office", payload: "flow_room:Office" },
            { label: "Dining Room", payload: "flow_room:Dining Room" }
          ]
        }, { headers: cors?.headers || {} });
      }

      // STEP 2: ROOM SELECTED -> ASK VIBE
      else if (userMessage.startsWith("flow_room:")) {
        const room = userMessage.replace("flow_room:", "").trim();
        // Store context in title
        return Response.json({
          reply: `Got it, **${room}**! Now, what kind of vibe or color palette are you looking for?`,
          type: "actions",
          data: [
            { label: "Modern & Beige", payload: `flow_vibe:${room} Modern Beige` },
            { label: "Bold & Colorful", payload: `flow_vibe:${room} Bold Colorful` },
            { label: "Calm & Nature", payload: `flow_vibe:${room} Calm Nature` }
          ]
        }, { headers: cors?.headers || {} });
      }

      // STEP 3: VIBE SELECTED -> ASK FORMAT (NEW STEP)
      else if (userMessage.startsWith("flow_vibe:")) {
        const currentContext = userMessage.replace("flow_vibe:", "").trim(); // e.g. "Living Room Modern Beige"
        return Response.json({
          reply: `Excellent choice! Do you prefer a painted look (Canvas) or a sleek Poster (print)?`,
          type: "actions",
          data: [
            { label: "Painting / Canvas", payload: `flow_final:${currentContext} [FORMAT:PAINTING]` },
            { label: "Poster / Print", payload: `flow_final:${currentContext} [FORMAT:POSTER]` },
            { label: "Any Surface", payload: `flow_final:${currentContext} [FORMAT:ANY]` }
          ]
        }, { headers: cors?.headers || {} });
      }

      // STEP 4: FINAL TRIGGER
      else if (userMessage.startsWith("flow_final:")) {
        let finalPayload = userMessage.replace("flow_final:", "").trim();

        // Extract Format
        if (finalPayload.includes("[FORMAT:PAINTING]")) {
          desiredFormat = "painting";
          finalPayload = finalPayload.replace("[FORMAT:PAINTING]", "").trim();
        } else if (finalPayload.includes("[FORMAT:POSTER]")) {
          desiredFormat = "poster";
          finalPayload = finalPayload.replace("[FORMAT:POSTER]", "").trim();
        } else {
          finalPayload = finalPayload.replace("[FORMAT:ANY]", "").trim();
        }

        userContext = `User completed guided flow. Request: ${finalPayload}. PREFERRED FORMAT: ${desiredFormat.toUpperCase()}`;
        searchQueries = []; // Will be generated by AI
        shouldSearch = true;
      }
    }

    // 3. VASTU LOGIC
    else if (userMessage.includes("vastu")) {
      // ... (Vastu logic)
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
        return Response.json({
          reply: "Vastu Shastra depends on direction. Which wall are you decorating?",
          type: "actions",
          data: [{ label: "North/East", payload: "Vastu North" }, { label: "South", payload: "Vastu South" }]
        }, { headers: cors?.headers || {} });
      }
    }
    else {
      // Standard Text Handling with INTENT CLASSIFICATION
      const apiKeySetting = await prisma.appSetting.findUnique({ where: { key: "GEMINI_API_KEY" } });

      if (apiKeySetting && apiKeySetting.value) {
        const { GoogleGenerativeAI } = await import("@google/generative-ai");
        const genAI = new GoogleGenerativeAI(apiKeySetting.value);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); // HIGH VERSION

        try {
          const intentPrompt = `
                User says: "${userMessage}"
                Act as a Friendly Art Store Assistant.
                Classify intent:
                1. "small_talk": Greetings (hi, hello), questions about you, thank yous, or general chat NOT related to buying/finding specific art.
                2. "search": Requests for art, descriptions of rooms, specific subjects (e.g. "blue abstract"), or Vastu questions.
                
                Return JSON: { "intent": "small_talk" | "search", "reply": "..." }
                If small_talk, write a warm, helpful, human-like reply in "reply".
                If search, leave "reply" empty (or null).
             `;

          const result = await model.generateContent(intentPrompt);
          const text = result.response.text();
          const jsonMatch = text.match(/\{.*\}/s);
          if (jsonMatch) {
            const json = JSON.parse(jsonMatch[0]);
            if (json.intent === "small_talk" && json.reply) {
              return Response.json({ reply: json.reply }, { headers: cors?.headers || {} });
            }
          }
        } catch (e) {
          console.error("Intent Classifier Error:", e);
          // Fallthrough to search if error
        }
      }

      // If Not Small Talk, Proceed to Search
      userContext = userMessage;
      // Basic detection for format in text
      if (userMessage.includes("poster") || userMessage.includes("print")) desiredFormat = "poster";
      else if (userMessage.includes("painting") || userMessage.includes("canvas")) desiredFormat = "painting";
      shouldSearch = true;
    }

    // --- EXPERT SEARCH EXECUTION ---
    if (shouldSearch) {

      // Define effective query
      let effectiveQuery = userContext;
      if (desiredFormat) {
        effectiveQuery += ` (User wants ${desiredFormat})`;
      }

      // 1. QUERY GENERATION
      const apiKeySetting = await prisma.appSetting.findUnique({ where: { key: "GEMINI_API_KEY" } });
      let genAI;
      let useAiCuration = false;

      if (apiKeySetting && apiKeySetting.value) {
        const { GoogleGenerativeAI } = await import("@google/generative-ai");
        genAI = new GoogleGenerativeAI(apiKeySetting.value);
        useAiCuration = true;

        if (searchQueries.length === 0) {
          try {
            const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); // HIGH VERSION

            // Expert Prompt with Format Awareness AND Stronger Logic
            const qPrompt = `Act as an Elite Art Curator. User input: "${effectiveQuery}". 
                    1. Analyze the core emotion, subject, and style.
                    2. Write a 1-sentence expert critique identifying exactly what fits.
                    3. Generate 6 DISTINCT, HIGH-IMPACT Shopify search terms.
                       - Mix styles (e.g. "Abstract"), subjects (e.g. "Landscape"), and moods (e.g. "Serene").
                       - If user asks a complex question, break it down into widely searchable tags.
                    4. CRITICAL: If format is 'painting', ensure 'Canvas' is a keyword. If 'poster', 'Print'.
                    
                    Return JSON: { "critique": "...", "searchQueries": ["Term1", "Term2", "Term3", "Term4", "Term5", "Term6"] }`;

            const result = await model.generateContent(qPrompt);
            const text = result.response.text();
            const jsonMatch = text.match(/\{.*\}/s);
            if (jsonMatch) {
              const json = JSON.parse(jsonMatch[0]);
              searchQueries = json.searchQueries || [];
              designCritique = json.critique || "";
              userContext = `Request: ${effectiveQuery}. Curator Note: ${designCritique}`;
            }
          } catch (e) {
            console.error("Text Query Gen Error:", e);
          }
        }
      }

      // Fallback or Empty
      if (searchQueries.length === 0) {
        searchQueries = [userMessage.replace("flow_final:", "").trim() || "Art"];
      }

      console.log("Broad Search Queries:", searchQueries);

      // 2. ROBUST POOLING (Fetch Tags/Type)
      const fetchProducts = async (q) => {
        const response = await admin.graphql(
          `#graphql
              query ($query: String!) {
                products(first: 50, query: $query) {
                  edges {
                    node {
                      id
                      title
                      handle
                      description(truncateAt: 100)
                      productType
                      vendor
                      tags
                      variants(first: 1) { edges { node { id } } }
                      priceRangeV2 { minVariantPrice { amount currencyCode } }
                      featuredImage { url }
                    }
                  }
                }
              }`,
          { variables: { query: `${q} status:active` } }
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

      // ZERO RESULT POLICY
      if (candidates.length < 5) {
        console.log("Pool too small. triggering Fallback 'Art' search.");
        const fallback = await fetchProducts("Art");
        fallback.forEach(edge => {
          if (!candidateMap.has(edge.node.handle)) {
            candidateMap.set(edge.node.handle, edge.node);
          }
        });
        candidates = Array.from(candidateMap.values());
      }

      // 3. EXPERT CURATION (STRICT FORMAT FILTER)
      let finalProducts = [];
      let expertAdvice = "";

      if (useAiCuration && candidates.length > 0) {
        try {
          // Pass metadata to AI
          const pool = candidates.slice(0, 50).map(p => ({
            handle: p.handle,
            title: p.title,
            type: p.productType,
            tags: p.tags, // Array of strings
            desc: p.description
          }));

          const curationPrompt = `
                    You are an Expert Interior Designer.
                    Context: "${designCritique || userContext}"
                    Required Format: "${desiredFormat || "Any"}"
                    
                    Task: Select the top 5 pieces from the list below.
                    
                    STRICT RULES:
                    1. If Required Format is 'painting', REJECT any item with type/tag 'Poster', 'Print', 'Paper'. Prefers 'Canvas', 'Original'.
                    2. If Required Format is 'poster', REJECT any item with type/tag 'Canvas', 'Original'. Prefers 'Print', 'Poster'.
                    3. Match the user's aesthetic perfectly.
                    
                    Candidates: ${JSON.stringify(pool)}

                    Return JSON: { "selectedHandles": ["..."], "expertAdvice": "I chose these because..." }
                `;

          const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); // HIGH VERSION
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
        let intro = "";
        if (designCritique) {
          intro += `${designCritique}\n\n`;
        }
        if (expertAdvice) {
          intro += `**Designer's Pick:** ${expertAdvice}`;
        } else {
          intro += "Here are the best matches for your space.";
        }

        replyPrefix = intro;

        const carouselData = finalProducts.map(node => ({
          title: node.title,
          price: `${node.priceRangeV2.minVariantPrice.amount} ${node.priceRangeV2.minVariantPrice.currencyCode}`,
          image: node.featuredImage?.url || "https://placehold.co/600x400?text=No+Image",
          url: `/products/${node.handle}`,
          variantId: node.variants?.edges?.[0]?.node?.id?.split('/').pop() || "", // Extract ID
          vendor: node.vendor || "Art Assistant"
        }));

        responseData = {
          reply: replyPrefix,
          type: "carousel",
          data: carouselData
        };
      } else {
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
