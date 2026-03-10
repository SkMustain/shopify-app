import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session, cors, admin } = await authenticate.public.appProxy(request);

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Debug Print: Check store products to see what tags/titles actually exist
  if (admin) {
    try {
      const res = await admin.graphql(`
        query {
          products(first: 20) {
            edges { node { title tags variants(first: 1) { edges { node { id, price { amount } } } } } }
          }
        }
       `);
      const json = await res.json();
      console.log("=== DEBUG: STORE INVENTORY DUMP ===");
      json.data.products.edges.forEach(edge => {
        console.log(`Title: "${edge.node.title}" | Tags: ${JSON.stringify(edge.node.tags)}`);
      });
    } catch (e) {
      console.log("Debug Search Error:", e);
    }
  }

  return Response.json({ status: "ok", message: "Art Assistant API v2 Ready" }, { headers: cors?.headers || {} });
};

export const action = async ({ request }) => {
  try {
    const { session, admin, cors } = await authenticate.public.appProxy(request);

    if (!session) {
      return Response.json({ reply: "Error: Unauthorized (Session invalid)" }, { headers: cors?.headers || {} });
    }

    const payload = await request.json();
    let userMessage = (payload.message || "").trim();
    const userImage = payload.image; // Base64 image
    let payloadTag = payload.payload; // From button clicks

    // FIX: Frontend sends payload strings (e.g. "FLOW_VISUAL:START") inside the `message` field.
    // We must extract it here so our state machine works.
    if (!payloadTag && userMessage.startsWith("FLOW_")) {
      payloadTag = userMessage;
      userMessage = ""; // Clear message so it acts purely as a payload event
    }

    // Import Prisma & Services
    const { default: prisma } = await import("../db.server");
    const { AntigravityBrain } = await import("../services/brain.server");

    // --- STATE MACHINE HELPERS ---
    // We infer state from the 'payloadTag' or specific keywords
    // Payloads follow pattern: "FLOW_NAME:STEP_NAME:DATA"

    let responseData = { reply: "I didn't capture that. Could you try again?" };

    // --- 1. INITIAL GREETING ---
    if (userMessage.toLowerCase() === "hi" || userMessage.toLowerCase() === "hello" || userMessage === "RESET_FLOW") {
      responseData = {
        reply: "Hi 👋\nLet’s find the perfect painting for your space.\n\nWhat would you like to do?",
        type: "actions",
        data: [
          { label: "📸 Upload My Room Photo", payload: "FLOW_VISUAL:START" },
          { label: "🖼 Help Me Choose", payload: "FLOW_GUIDE:START" }
        ]
      };
    }

    // --- 2. FLOW 1: VISUAL SEARCH (Upload -> Colors -> Theme -> Search) ---
    else if (payloadTag?.startsWith("FLOW_VISUAL:") || (userImage && !payloadTag)) {
      const step = payloadTag ? payloadTag.split(":")[1] : "HANDLE_IMAGE";

      if (step === "START") {
        responseData = {
          reply: "Please upload a clear photo of your room wall. 📸",
          type: "actions",
          data: []
        };
      }
      else if (step === "HANDLE_IMAGE" || (userImage && !payloadTag)) {
        // Run Gemini Vision Analysis
        const apiKeyObj = await prisma.appSetting.findUnique({ where: { key: "GEMINI_API_KEY" } });
        const apiKey = (apiKeyObj?.value || process.env.GEMINI_API_KEY || "").trim();

        if (!apiKey) {
          responseData = { reply: "I need a Gemini API Key to analyze images. Please add it in the Admin Dashboard." };
        } else {
          try {
            // Save to DB to persist analysis for later steps
            const newImg = await prisma.customerImage.create({
              data: { imageData: userImage.substring(0, 100) + "...", analysisResult: "Analyzing" }
            });
            const imageId = newImg.id.toString();

            const { GoogleGenerativeAI } = await import("@google/generative-ai");
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

            const mimeTypeMatch = userImage.match(/[^:]\w+\/[\w-+\d.]+(?=;|,)/);
            const mimeType = mimeTypeMatch ? mimeTypeMatch[0] : "image/jpeg";
            const base64Data = userImage.replace(/^data:image\/\w+;base64,/, "");

            const imagePart = {
              inlineData: { data: base64Data, mimeType }
            };

            const tagsList = "Abstract, Abstract Flower, Abstract Ganesha, adiyogi painting, adventure painting, aesthetic painting, African Drummers, Ancient Ruins, architecture wall decor, artistic painting, autumn leaf painting, baby portrait painting, bharatnatyam painting, bird artwork, Black, Blue, boat canvas, bright color painting, Brown, buddha painting, buddhist painting, Burj Khalifa, calm sea painting, Canvas Painting, Cityscape, classical painting, close-up abstract, Colorful, Couple Name Plate, cyberpunk, dancing girl painting, dark art, divine wall art, dream art painting, Dystopian Cityscape, Emotional Harmony Flow, Energetic, European city, Floral, forest landscape painting, Futuristic, ganesh painting, Gold, Green, grounded environment, Heart Wall Painting, historical painting, horizon painting, indian art painting, japanese art, Kids Room Painting, krishna painting, landscape painting, London, lord shiva painting, love painting, mahadev painting, Minimalism, Modern, Mountain, Musicians Painting, mystical wall art, nature, Nautical, Navy, Nostalgia, ocean painting, Orange, peaceful nature, Personalized Wall Plate, Pink, pooja room painting, Portrait, Purple, rainbow painting, Red, Religious Painting, Romantic, Round Name Plate, Scenery, Serenity, Seven Horses, Silver, spiritual painting, Sunset, temple painting, traditional indian art, Tranquility, travel art, tree painting, Tribal, urban street art, vastu painting, Venice, Vintage, wall art, Water Fall, Watercolor, White, wild life painting, woman painting, Yellow";

            const prompt = `You are an expert interior designer. Analyze this room and strictly return a JSON object with:
1. "description": A 1-sentence description of the room.
2. "initial_search_query": Select 2-3 EXACT tags from this list that best fit the room's vibe to query my store instantly: [${tagsList}].
3. "suggested_colors": Exactly 3 color palettes for follow-up refinement (e.g. ["Warm Golds", "Vibrant Blues", "Neutral Earth Tones"]).
Do not include markdown blocks or any other text. Just the raw JSON.`;

            console.log("Calling Gemini Vision for deep analysis...");
            const result = await model.generateContent([prompt, imagePart]);
            let responseText = result.response.text().trim();
            if (responseText.startsWith("```json")) {
              responseText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
            }
            const analysis = JSON.parse(responseText);

            console.log("Vision Analysis successful:", analysis);

            await prisma.customerImage.update({
              where: { id: parseInt(imageId) },
              data: { analysisResult: analysis.description }
            });

            const c1 = analysis.suggested_colors[0] || "Warm Tones";
            const c2 = analysis.suggested_colors[1] || "Cool Blues";
            const c3 = analysis.suggested_colors[2] || "Neutral";

            // Immediately search using the suggested tags
            const initialSearch = await executeSearch(admin, analysis.initial_search_query, {});

            responseData = {
              reply: `I see ${analysis.description}! ✨\n\nI've placed some initial suggestions in the sidebar based on my analysis of your room. To refine these results perfectly, what color palette would you prefer?`,
              carousel: initialSearch.data || [],
              actions: [
                { label: `🎨 ${c1}`, payload: `FLOW_VISUAL:COLOR:${imageId}:${c1}` },
                { label: `🎨 ${c2}`, payload: `FLOW_VISUAL:COLOR:${imageId}:${c2}` },
                { label: `🎨 ${c3}`, payload: `FLOW_VISUAL:COLOR:${imageId}:${c3}` },
                { label: "Surprise Me", payload: `FLOW_VISUAL:COLOR:${imageId}:Surprise` }
              ]
            };
          } catch (e) {
            console.error("Vision Error:", e);
            // Fallback options if Vision fails (e.g. quota, parsing error)
            responseData = {
              reply: "I received your photo! What color preference do you have for the artwork?",
              type: "actions",
              data: [
                { label: "Warm & Cozy", payload: "FLOW_VISUAL:COLOR:0:Warm" },
                { label: "Cool & Calming", payload: "FLOW_VISUAL:COLOR:0:Blue" },
                { label: "Bold & Vibrant", payload: "FLOW_VISUAL:COLOR:0:Colorful" },
                { label: "Neutral & Minimal", payload: "FLOW_VISUAL:COLOR:0:Neutral" }
              ]
            };
          }
        }
      }
      else if (step === "COLOR") {
        const imgId = payloadTag.split(":")[2];
        const color = payloadTag.split(":")[3];

        responseData = {
          reply: `Great choice! What theme of painting do you like best?`,
          type: "actions",
          data: [
            { label: "Modern Abstract", payload: `FLOW_VISUAL:THEME:${imgId}:${color}:Abstract` },
            { label: "Nature & Landscape", payload: `FLOW_VISUAL:THEME:${imgId}:${color}:Nature` },
            { label: "Spiritual / Devotional", payload: `FLOW_VISUAL:THEME:${imgId}:${color}:Spiritual` },
            { label: "Cityscape / Travel", payload: `FLOW_VISUAL:THEME:${imgId}:${color}:Cityscape` }
          ]
        };
      }
      else if (step === "THEME") {
        const parts = payloadTag.split(":");
        const imgId = parts[2];
        const color = parts[3];
        const theme = parts[4];

        const cleanColor = color === "Surprise" ? "" : color.split(" ")[0];
        const query = `${theme} ${cleanColor}`.trim();

        const searchResult = await executeSearch(admin, query, {});
        responseData = {
          reply: `Here are the perfect matches for your room! ✨\n\nHow would you like to refine these results?`,
          type: "carousel",
          carousel: searchResult.data || [],
          actions: [
            { label: "Vastu Friendly 🧭", payload: `FLOW_VISUAL:REFINE:${imgId}:${color}:${theme}:VASTU` },
            { label: "Under ₹2000 💰", payload: `FLOW_VISUAL:REFINE:${imgId}:${color}:${theme}:BUDGET_LOW` },
            { label: "Premium/Luxury ✨", payload: `FLOW_VISUAL:REFINE:${imgId}:${color}:${theme}:BUDGET_HIGH` },
            { label: "Change Theme 🎨", payload: `FLOW_VISUAL:COLOR:${imgId}:${color}` }
          ]
        };
      }
      else if (step === "REFINE") {
        const parts = payloadTag.split(":");
        const imgId = parts[2];
        const color = parts[3];
        const theme = parts[4];
        const refinement = parts[5];

        const cleanColor = color === "Surprise" ? "" : color.split(" ")[0];
        let query = `${theme} ${cleanColor}`.trim();
        let budgetFilter = null;

        if (refinement === "VASTU") {
          query += " Vastu";
        } else if (refinement === "BUDGET_LOW") {
          budgetFilter = "Low";
        } else if (refinement === "BUDGET_HIGH") {
          budgetFilter = "High";
        }

        const searchResult = await executeSearch(admin, query, { budget: budgetFilter });

        responseData = {
          reply: `I've updated your curation! ✨\n\nWhat other adjustments would you like to make?`,
          type: "carousel",
          carousel: searchResult.data || [],
          actions: [
            { label: "Add Vastu Magic 🧭", payload: `FLOW_VISUAL:REFINE:${imgId}:${color}:${theme}:VASTU` },
            { label: "Change Theme 🎨", payload: `FLOW_VISUAL:COLOR:${imgId}:${color}` },
            { label: "Explore Budget Options 💰", payload: `FLOW_VISUAL:REFINE:${imgId}:${color}:${theme}:BUDGET_LOW` },
            { label: "Start Over 🏠", payload: `RESET_FLOW` }
          ]
        };
      }
    }

    // --- 3. FLOW 2: HELP ME CHOOSE (Vastu vs Others) ---
    else if (payloadTag?.startsWith("FLOW_GUIDE:")) {
      const parts = payloadTag.split(":");
      const step = parts[1];

      if (step === "START") {
        responseData = {
          reply: "I’ll help you choose something stunning ✨\nWhat kind of paintings are you looking for?",
          type: "actions",
          data: [
            { label: "🧭 Vastu Friendly Paintings", payload: "FLOW_GUIDE:VASTU" },
            { label: "🎨 Other Themes", payload: "FLOW_GUIDE:OTHERS" }
          ]
        };
      }

      else if (step === "VASTU") {
        responseData = {
          reply: "Great! Which direction does your wall face?",
          type: "actions",
          data: [
            { label: "North (Wealth/Water)", payload: "FLOW_GUIDE:SEARCH:tag:Vastu-North" },
            { label: "South (Fame/Fire)", payload: "FLOW_GUIDE:SEARCH:tag:Vastu-South" },
            { label: "East (Health/Air)", payload: "FLOW_GUIDE:SEARCH:tag:Vastu-East" },
            { label: "West (Gains/Space)", payload: "FLOW_GUIDE:SEARCH:tag:Vastu-West" },
            { label: "Show All Vastu", payload: "FLOW_GUIDE:SEARCH:collection:'Vastu Walls'" }
          ]
        };
      }

      else if (step === "OTHERS") {
        responseData = {
          reply: "Pick a theme that suits your style:",
          type: "actions",
          data: [
            { label: "Modern & Abstract", payload: "FLOW_GUIDE:SEARCH:collection:'Modern & Abstract'" },
            { label: "Nature & Landscapes", payload: "FLOW_GUIDE:SEARCH:collection:'Nature & Landscapes'" },
            { label: "Spiritual & Religious", payload: "FLOW_GUIDE:SEARCH:collection:'Spiritual & Religious'" },
            { label: "City & Travel", payload: "FLOW_GUIDE:SEARCH:collection:'Urban & City Life'" }
          ]
        };
      }

      else if (step === "SEARCH") {
        const query = parts.slice(2).join(":");
        const searchResult = await executeSearch(admin, query, {});

        responseData = {
          reply: `Here are our best picks for you! ✨\n\n**Confidence Booster:** 4.8★ Rated by 1,200+ customers!\n\nTo help you further, what else are you looking for?`,
          type: "carousel",
          carousel: searchResult.data || [],
          actions: [
            { label: "Needs More Calm 🌿", payload: `FLOW_GUIDE:REFINE:${query}:CALM` },
            { label: "Under ₹5000 💰", payload: `FLOW_GUIDE:REFINE:${query}:BUDGET` },
            { label: "Start Over 🏠", payload: "RESET_FLOW" }
          ]
        };
      }
      else if (step === "REFINE") {
        // Find where the refinement stops (the last part is the refinement type)
        // Everything between index 2 and length-1 is the query.
        const refinement = parts[parts.length - 1];
        const query = parts.slice(2, -1).join(":");

        // Ensure we pass the query back up correctly
        const searchResult = await executeSearch(admin, query, { budget: refinement === "BUDGET" ? "Mid" : null });
        responseData = {
          reply: `Perfect! I've refined the results for you. ✨\n\nShall we keep tweaking?`,
          type: "carousel",
          carousel: searchResult.data || [],
          actions: [
            { label: "Show Different Styles", payload: `FLOW_GUIDE:OTHERS` },
            { label: "Start Over 🏠", payload: "RESET_FLOW" }
          ]
        };
      }
    }

    // --- 4. GENERIC TEXT HANDLER (Freeform Search) ---
    else if (userMessage) {
      // Try to search the store with the user's exact message
      const searchResult = await executeSearch(admin, userMessage, {});

      if (searchResult.data && searchResult.data.length > 0) {
        responseData = {
          reply: `Here are some ${userMessage} options I found for you! ✨\n\nWould you like to refine this search or try something else?`,
          type: "carousel",
          carousel: searchResult.data,
          actions: [
            { label: "📸 Upload My Room Photo", payload: "FLOW_VISUAL:START" },
            { label: "🖼 Help Me Choose", payload: "FLOW_GUIDE:START" }
          ]
        };
      } else {
        responseData = {
          reply: `I couldn't find exact matches for "${userMessage}".\n\nI'm your personal Art Assistant! Please choose an option below to find your perfect painting. 👇`,
          type: "actions",
          data: [
            { label: "📸 Upload My Room Photo", payload: "FLOW_VISUAL:START" },
            { label: "🖼 Help Me Choose", payload: "FLOW_GUIDE:START" }
          ]
        };
      }
    }

    return Response.json(responseData, { headers: cors?.headers || {} });

  } catch (error) {
    console.error("Proxy Error:", error);
    return Response.json({
      reply: `Sorry, I'm having trouble right now. Please try again later. (Error: ${error.message})`
    }, { status: 200 });
  }
};


// --- SEARCH HELPER ---
async function executeSearch(admin, query, filters) {
  const { budget } = filters;
  let products = [];
  console.log("------------------- EXECUTE SEARCH TRIGGERED -------------------");
  console.log("RAW QUERY:", query);

  try {
    const isCollection = query.includes("collection:");
    const isTag = query.includes("tag:");
    let textQuery = query.replace("collection:", "").replace("tag:", "").replace(/['"]/g, "").trim();

    // 1. If it's a VASTU tag, the user grouped all directions in "Vastu Walls" collection
    if (isTag && textQuery.toLowerCase().includes("vastu")) {
      console.log("Vastu Tag Detected -> Redirecting to Vastu Walls Collection");
      textQuery = "Vastu Walls";
    }

    // 2. FUZZY COLLECTION MATCHING
    // Always fetch collections and do a forgiving 'includes' match on the first major word
    const colIdResponse = await admin.graphql(`
      query {
        collections(first: 100) {
          edges { node { id, title } }
        }
      }
    `);
    const colIdJson = await colIdResponse.json();
    const allCols = colIdJson.data?.collections?.edges || [];

    // Fuzzy matching strategy: e.g. "Nature & Landscapes" -> "Nature"
    const primaryWord = textQuery.split(" ")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
    let matchedCollection = allCols.find(e => e.node.title.trim().toLowerCase() === textQuery.toLowerCase());

    if (!matchedCollection && primaryWord.length > 2) {
      matchedCollection = allCols.find(e => e.node.title.toLowerCase().includes(primaryWord));
    }

    // 3. FETCH PRODUCTS FROM COLLECTION
    if (matchedCollection) {
      console.log("FUZZY MATCH SUCCESS! Found Collection ID:", matchedCollection.node.id, "for", textQuery);
      const response = await admin.graphql(
        `#graphql
          query ($colId: ID!) {
            collection(id: $colId) {
              products(first: 20) {
                edges {
                  node {
                    id title handle description(truncateAt: 100) productType vendor tags
                    variants(first: 1) { edges { node { id, price { amount currencyCode } } } }
                    featuredImage { url } priceRangeV2 { minVariantPrice { amount currencyCode } }
                  }
                }
              }
            }
          }`,
        { variables: { colId: matchedCollection.node.id } }
      );
      const json = await response.json();
      products = json.data?.collection?.products?.edges.map(e => e.node) || [];
    }

    // 4. FALLBACK TO FREEFORM TEXT SEARCH 
    if (products.length === 0 && !isCollection) {
      console.log("FALLING BACK TO FREEFORM SEARCH FOR:", textQuery);
      let finalQuery = textQuery.split(' ').filter(w => w.trim().length > 2).map(w => `(title:${w}* OR tag:${w}*)`).join(' AND ');
      if (!finalQuery) finalQuery = "title:''";

      const response = await admin.graphql(
        `#graphql
          query ($query: String!) {
            products(first: 20, query: $query) {
              edges {
                node {
                  id title handle description(truncateAt: 100) productType vendor tags
                  variants(first: 1) { edges { node { id, price { amount currencyCode } } } }
                  featuredImage { url } priceRangeV2 { minVariantPrice { amount currencyCode } }
                }
              }
            }
          }`,
        { variables: { query: finalQuery } }
      );
      const json = await response.json();
      products = json.data?.products?.edges.map(e => e.node) || [];
    }

    // 5. BULLETPROOF FAILSAFE - NEVER RETURN EMPTY ARRAY
    if (products.length === 0) {
      console.log("BULLETPROOF FAILSAFE: Returning Top latest products because zero matches found.");
      const response = await admin.graphql(
        `#graphql
          query {
            products(first: 10) {
              edges {
                node {
                  id title handle description(truncateAt: 100) productType vendor tags
                  variants(first: 1) { edges { node { id, price { amount currencyCode } } } }
                  featuredImage { url } priceRangeV2 { minVariantPrice { amount currencyCode } }
                }
              }
            }
          }`
      );
      const json = await response.json();
      products = json.data?.products?.edges.map(e => e.node) || [];
    }

    // Apply Budget Filter
    if (budget) {
      products = products.filter(p => {
        const price = parseFloat(p.priceRangeV2?.minVariantPrice?.amount || "0");
        if (budget === "Low") return price >= 999 && price <= 1999;
        if (budget === "Mid") return price >= 2000 && price <= 5000;
        if (budget === "High") return price > 5000;
        return true;
      });
    }

    products = products.slice(0, 10);

    const carouselData = products.map(node => ({
      title: node.title,
      price: node.priceRangeV2?.minVariantPrice ? `${node.priceRangeV2.minVariantPrice.amount} ${node.priceRangeV2.minVariantPrice.currencyCode}` : "Price N/A",
      image: node.featuredImage?.url || "https://placehold.co/600x400?text=No+Image",
      url: `/products/${node.handle}`,
      variantId: node.variants?.edges?.[0]?.node?.id?.split('/').pop() || "",
      vendor: node.vendor || "Art Assistant"
    }));

    return { type: "carousel", data: carouselData };

  } catch (error) {
    console.error("ExecuteSearch Error:", error);
    return { type: "carousel", data: [] };
  }
}
