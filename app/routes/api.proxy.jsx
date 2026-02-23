import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session, cors } = await authenticate.public.appProxy(request);

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
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
    const userMessage = (payload.message || "").trim();
    const userImage = payload.image; // Base64 image
    const payloadTag = payload.payload; // From button clicks

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

    // --- 2. FLOW 1: VISUAL SEARCH (Upload -> Gemini -> Search) ---
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
            // Save to DB (optional, but good for gallery)
            await prisma.customerImage.create({
              data: { imageData: userImage, analysisResult: "Analyzed" }
            });

            const { GoogleGenerativeAI } = await import("@google/generative-ai");
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

            const mimeTypeMatch = userImage.match(/[^:]\w+\/[\w-+\d.]+(?=;|,)/);
            const mimeType = mimeTypeMatch ? mimeTypeMatch[0] : "image/jpeg";
            const base64Data = userImage.replace(/^data:image\/\w+;base64,/, "");

            const imagePart = {
              inlineData: { data: base64Data, mimeType }
            };

            const prompt = `Analyze this room. You are an expert interior designer. Suggest the best art style for this wall. Output ONLY a concise 3-5 word search query representing the best art for it, using these tags if applicable: Abstract, Canvas, Floral, Modern, Cityscape, Nature, Buddha, Vastu. Example: "Modern Blue Abstract Canvas". Do NOT add any other text.`;

            console.log("Calling Gemini Vision...");
            const result = await model.generateContent([prompt, imagePart]);
            const query = result.response.text().trim().replace(/['"]/g, '');
            console.log("Gemini Vision returned query:", query);

            const searchResult = await executeSearch(admin, query, {});
            responseData = {
              reply: `I see your room! Based on the vibe, I found these perfect matches for you. ✨\n\n*(Curated for: ${query})*`,
              type: "carousel",
              data: searchResult.data || []
            };
          } catch (e) {
            console.error("Vision Error:", e);
            responseData = { reply: "Sorry, I had trouble analyzing the image right now. Let's try picking a theme instead.", type: "actions", data: [{ label: "🖼 Help Me Choose", payload: "FLOW_GUIDE:START" }] };
          }
        }
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
            { label: "North (Wealth/Water)", payload: "FLOW_GUIDE:SEARCH:Water Blue" },
            { label: "South (Fame/Fire)", payload: "FLOW_GUIDE:SEARCH:Red Horses Fire" },
            { label: "East (Health/Air)", payload: "FLOW_GUIDE:SEARCH:Green Nature Plant" },
            { label: "West (Gains/Space)", payload: "FLOW_GUIDE:SEARCH:White Gold" }
          ]
        };
      }

      else if (step === "OTHERS") {
        responseData = {
          reply: "Pick a theme that suits your style:",
          type: "actions",
          data: [
            { label: "Modern Abstract", payload: "FLOW_GUIDE:SEARCH:Modern Abstract" },
            { label: "Nature & Landscape", payload: "FLOW_GUIDE:SEARCH:Nature Landscape" },
            { label: "Spiritual & Devotional", payload: "FLOW_GUIDE:SEARCH:Buddha Ganesha Spiritual" },
            { label: "City & Travel", payload: "FLOW_GUIDE:SEARCH:Cityscape Travel" }
          ]
        };
      }

      else if (step === "SEARCH") {
        const query = parts[2];
        const searchResult = await executeSearch(admin, query, {});
        responseData = {
          reply: `Here are our best picks for you! ✨\n\n**Confidence Booster:** 4.8★ Rated by 1,200+ customers!`,
          type: "carousel",
          data: searchResult.data || []
        };
      }
    }

    // --- 4. GENERIC TEXT HANDLER (Catch-all) ---
    else if (userMessage) {
      responseData = {
        reply: "I'm your personal Art Assistant! Please choose an option below to find your perfect painting. 👇",
        type: "actions",
        data: [
          { label: "📸 Upload My Room Photo", payload: "FLOW_VISUAL:START" },
          { label: "🖼 Help Me Choose", payload: "FLOW_GUIDE:START" }
        ]
      };
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

  // Construct Query
  let finalQuery = query;

  try {
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
                    variants(first: 1) { edges { node { id, price { amount currencyCode } } } }
                    featuredImage { url }
                    priceRangeV2 { minVariantPrice { amount currencyCode } }
                  }
                }
              }
            }`,
      { variables: { query: finalQuery } }
    );

    const json = await response.json();
    let products = json.data?.products?.edges.map(e => e.node) || [];

    // Apply Budget Filter in Memory
    if (budget) {
      products = products.filter(p => {
        const price = parseFloat(p.priceRangeV2?.minVariantPrice?.amount || "0");
        if (budget === "Low") return price >= 999 && price <= 1999;
        if (budget === "Mid") return price >= 2000 && price <= 5000;
        if (budget === "High") return price > 5000;
        return true;
      });
    }

    // Slice top 10
    products = products.slice(0, 10);

    if (products.length === 0) {
      return {
        reply: `I couldn't find exact matches for "${query}" within that budget. Here are some other options!`,
      };
    }

    const carouselData = products.map(node => ({
      title: node.title,
      price: node.priceRangeV2?.minVariantPrice ? `${node.priceRangeV2.minVariantPrice.amount} ${node.priceRangeV2.minVariantPrice.currencyCode}` : "Price N/A",
      image: node.featuredImage?.url || "https://placehold.co/600x400?text=No+Image",
      url: `/products/${node.handle}`,
      variantId: node.variants?.edges?.[0]?.node?.id?.split('/').pop() || "",
      vendor: node.vendor || "Art Assistant"
    }));

    return {
      type: "carousel",
      data: carouselData
    };

  } catch (e) {
    console.error("Search Helper Error", e);
    return { reply: "I'm having trouble searching the catalog right now." };
  }
}
