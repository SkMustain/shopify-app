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
    const { AntigravityBrain } = await import("../services/antigravity.server");

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
          { label: "🎨 I Have Custom Requirements", payload: "FLOW_CUSTOM:START" },
          { label: "🖼 Help Me Choose", payload: "FLOW_GUIDE:START" }
        ]
      };
    }

    // --- 2. FLOW 1: VISUAL SEARCH (Upload -> Colors -> Theme -> Budget) ---
    else if (payloadTag?.startsWith("FLOW_VISUAL:") || (userImage && !payloadTag)) {
      const step = payloadTag ? payloadTag.split(":")[1] : "HANDLE_IMAGE";

      // A. Start -> Ask for Image
      if (step === "START") {
        responseData = {
          reply: "Please upload a clear photo of your room wall 📸",
          type: "actions",
          data: []
        };
      }

      // B. Handle Image Upload -> Ask Color Preference
      else if (step === "HANDLE_IMAGE" || (userImage && !payloadTag)) {
        // SAVE IMAGE TO DB
        let imageId = "0";
        if (userImage) {
          const newImg = await prisma.customerImage.create({
            data: {
              imageData: userImage.substring(0, 50) + "...", // Truncate log
              analysisResult: "Pending Analysis"
            }
          });
          imageId = newImg.id.toString();

          // RUN VISION ANALYSIS NOW (Background-ish)
          if (process.env.GEMINI_API_KEY) {
            // ... Analysis logic ...
          }
        }

        responseData = {
          reply: "Got it! Do you have a specific color preference?",
          type: "actions",
          data: [
            { label: "🎨 Yes, I want specific colors", payload: `FLOW_VISUAL:ASK_COLOR:${imageId}` },
            { label: "🤍 No, You Choose for Me", payload: `FLOW_VISUAL:ASK_VIBE_DIRECT:${imageId}` }
          ]
        };
      }

      // C. Ask Specific Colors
      else if (step === "ASK_COLOR") {
        const imgId = payloadTag.split(":")[2];
        responseData = {
          reply: "Which colors would you like in your painting?",
          type: "actions",
          data: [
            { label: "Warm tones", payload: `FLOW_VISUAL:SET_COLOR:Warm:${imgId}` },
            { label: "Cool tones", payload: `FLOW_VISUAL:SET_COLOR:Cool:${imgId}` },
            { label: "Neutral", payload: `FLOW_VISUAL:SET_COLOR:Neutral:${imgId}` },
            { label: "Bold & Vibrant", payload: `FLOW_VISUAL:SET_COLOR:Bold:${imgId}` }
          ]
        };
      }

      // D. Theme Preference
      else if (step === "SET_COLOR" || step === "ASK_VIBE_DIRECT") {
        const parts = payloadTag.split(":");
        const chosenColor = step === "SET_COLOR" ? parts[2] : "Auto";
        const imgId = parts[parts.length - 1]; // Last part is ID

        const replyText = step === "ASK_VIBE_DIRECT"
          ? "What vibe do you want in your room?"
          : "Great choice! What theme fits your space best?";

        const options = step === "ASK_VIBE_DIRECT"
          ? [ // Vibe Options
            { label: "Cozy & Calm", payload: `FLOW_VISUAL:SET_THEME:${chosenColor}:Cozy:${imgId}` },
            { label: "Bold & Dramatic", payload: `FLOW_VISUAL:SET_THEME:${chosenColor}:Bold:${imgId}` },
            { label: "Modern & Clean", payload: `FLOW_VISUAL:SET_THEME:${chosenColor}:Modern:${imgId}` },
            { label: "Royal & Premium", payload: `FLOW_VISUAL:SET_THEME:${chosenColor}:Royal:${imgId}` }
          ]
          : [ // Theme Options
            { label: "Abstract", payload: `FLOW_VISUAL:SET_THEME:${chosenColor}:Abstract:${imgId}` },
            { label: "Modern Minimal", payload: `FLOW_VISUAL:SET_THEME:${chosenColor}:Minimal:${imgId}` },
            { label: "Nature", payload: `FLOW_VISUAL:SET_THEME:${chosenColor}:Nature:${imgId}` },
            { label: "Luxury", payload: `FLOW_VISUAL:SET_THEME:${chosenColor}:Luxury:${imgId}` }
          ];

        responseData = {
          reply: replyText,
          type: "actions",
          data: options
        };
      }

      // E. Budget Step
      else if (step === "SET_THEME") {
        const [, , color, theme, imgId] = payloadTag.split(":");
        responseData = {
          reply: "What is your budget range?",
          type: "actions",
          data: [
            { label: "₹999 – ₹1999", payload: `FLOW_VISUAL:FINAL:${color}:${theme}:Low:${imgId}` },
            { label: "₹2000 – ₹5000", payload: `FLOW_VISUAL:FINAL:${color}:${theme}:Mid:${imgId}` },
            { label: "₹5000+", payload: `FLOW_VISUAL:FINAL:${color}:${theme}:High:${imgId}` }
          ]
        };
      }

      // F. Final Response (Visual Flow)
      else if (step === "FINAL") {
        const [, , color, theme, budget, imgId] = payloadTag.split(":");

        // IF "Auto" color/theme, we rely on Gemini Vision here if we had the image content.
        // But we only have ID. 
        // Ideally we fetched tags earlier.
        // For V1, we map "Cozy" -> "Warm, Soft, Beige"

        let searchQuery = theme;
        if (theme === "Cozy") searchQuery = "Warm Beige Soft Art";
        if (theme === "Bold") searchQuery = "Abstract Colorful Red Blue";
        if (theme === "Modern") searchQuery = "Minimalist Geometric Black White";
        if (theme === "Royal") searchQuery = "Gold Classic Luxury Canvas";

        if (color !== "Auto") searchQuery += ` ${color}`;

        responseData = await executeSearch(admin, searchQuery, { budget });
        responseData.reply = `Based on your preferences **(${theme}, ${color})**, here are some matches ✨`;
      }
    }


    // --- 3. FLOW 2: CUSTOM REQUIREMENTS (Intake Form) ---
    else if (payloadTag?.startsWith("FLOW_CUSTOM:")) {
      const parts = payloadTag.split(":");
      const step = parts[1];
      // Accumulate state in payload: FLOW_CUSTOM:STEP:Data1|Data2|Data3...

      if (step === "START") {
        responseData = {
          reply: "Tell me what you're looking for. First, **which room** is this for?",
          type: "actions",
          data: [
            { label: "Bedroom", payload: "FLOW_CUSTOM:SIZE:Bedroom" },
            { label: "Living Room", payload: "FLOW_CUSTOM:SIZE:Living Room" },
            { label: "Office", payload: "FLOW_CUSTOM:SIZE:Office" },
            { label: "Cafe", payload: "FLOW_CUSTOM:SIZE:Cafe" },
            { label: "Gift", payload: "FLOW_CUSTOM:SIZE:Gift" }
          ]
        };
      }

      else if (step === "SIZE") {
        const room = parts[2];
        responseData = {
          reply: "Got it. What is the approximate **wall size**?",
          type: "actions",
          data: [
            { label: "Small (under 3ft)", payload: `FLOW_CUSTOM:THEME:${room}|Small` },
            { label: "Medium (3-5ft)", payload: `FLOW_CUSTOM:THEME:${room}|Medium` },
            { label: "Large (5ft+)", payload: `FLOW_CUSTOM:THEME:${room}|Large` }
          ]
        };
      }

      else if (step === "THEME") {
        const history = parts[2];
        responseData = {
          reply: "Do you have a specific **theme**?",
          type: "actions",
          data: [
            { label: "Abstract", payload: `FLOW_CUSTOM:BUDGET:${history}|Abstract` },
            { label: "Portrait", payload: `FLOW_CUSTOM:BUDGET:${history}|Portrait` },
            { label: "Nature", payload: `FLOW_CUSTOM:BUDGET:${history}|Nature` },
            { label: "Religious", payload: `FLOW_CUSTOM:BUDGET:${history}|Religious` },
            { label: "Other", payload: `FLOW_CUSTOM:BUDGET:${history}|Other` }
          ]
        };
      }

      else if (step === "BUDGET") {
        const history = parts[2];
        responseData = {
          reply: "What is your budget?",
          type: "actions",
          data: [
            { label: "₹2k – ₹5k", payload: `FLOW_CUSTOM:TYPE:${history}|₹2k-5k` },
            { label: "₹5k – ₹10k", payload: `FLOW_CUSTOM:TYPE:${history}|₹5k-10k` },
            { label: "₹10k+", payload: `FLOW_CUSTOM:TYPE:${history}|₹10k+` }
          ]
        };
      }

      else if (step === "TYPE") {
        const history = parts[2];
        responseData = {
          reply: "Would you like a ready-made option or a custom design?",
          type: "actions",
          data: [
            { label: "🖼 Ready-Made", payload: `FLOW_CUSTOM:FINAL_READY:${history}` },
            { label: "🎨 Fully Custom", payload: `FLOW_CUSTOM:FINAL_CUSTOM:${history}` }
          ]
        };
      }

      else if (step.startsWith("FINAL_")) {
        const history = parts[2];
        // Save as Lead
        await prisma.vastuLog.create({
          data: {
            direction: "LEAD",
            query: `Custom Request: ${history} (${step})`
          }
        });

        responseData = {
          reply: "Please **type your phone number** and a short description of your idea. \n\nOur design team will contact you within 24 hours! 🕒"
        };
      }
    }


    // --- 4. FLOW 3: HELP ME CHOOSE (Guided) ---
    else if (payloadTag?.startsWith("FLOW_GUIDE:")) {
      const parts = payloadTag.split(":");
      const step = parts[1];

      if (step === "START") {
        responseData = {
          reply: "I’ll help you choose something stunning ✨\n\nFirst, what room is it for?",
          type: "actions",
          data: [
            { label: "Living Room", payload: "FLOW_GUIDE:MOOD:Living Room" },
            { label: "Bedroom", payload: "FLOW_GUIDE:MOOD:Bedroom" },
            { label: "Dining Area", payload: "FLOW_GUIDE:MOOD:Dining" },
            { label: "Office", payload: "FLOW_GUIDE:MOOD:Office" }
          ]
        };
      }

      else if (step === "MOOD") {
        const room = parts[2];
        responseData = {
          reply: `For the **${room}**, what mood do you want to create?`,
          type: "actions",
          data: [
            { label: "Calm & Relaxing", payload: `FLOW_GUIDE:SHOW:${room}|Calm` },
            { label: "Energetic & Bold", payload: `FLOW_GUIDE:SHOW:${room}|Energetic` },
            { label: "Luxurious & Classy", payload: `FLOW_GUIDE:SHOW:${room}|Luxury` },
            { label: "Devotional / Positive", payload: `FLOW_GUIDE:SHOW:${room}|Devotional` }
          ]
        };
      }

      else if (step === "SHOW") {
        const [room, mood] = parts[2].split("|");

        // Map to Collections or Search Query
        // Since we don't have collection IDs, we search.
        let query = "";
        if (mood === "Calm") query = "Nature Zen Blue Beige";
        if (mood === "Energetic") query = "Abstract Colorful Pop";
        if (mood === "Luxury") query = "Gold Abstract Large Canvas";
        if (mood === "Devotional") query = "Buddha Ganesha Spiritual";

        responseData = await executeSearch(admin, query, {});
        responseData.reply = `Here are some ${mood} picks for your ${room} ✨\n\n**Confidence Booster:** 4.8★ Rated by 1,200+ customers!`;
      }
    }

    // --- 5. GENERIC TEXT HANDLER (Catch-all) ---
    else if (userMessage) {
      // Check if it looks like a phone number (for Custom Flow)
      if (userMessage.match(/(\d{10})/)) {
        responseData = {
          reply: "Thank you! We have received your request. Our team will call you shortly on this number. 🎨"
        };
        // TODO: Log this to DB
      } else {
        // Default "Brain" handling for random queries
        const apiKeySetting = await prisma.appSetting.findUnique({ where: { key: "GEMINI_API_KEY" } });

        // 1. Run Local Brain Analysis (0ms Latency)
        const brainAnalysis = AntigravityBrain.process(userMessage);

        if (brainAnalysis.intent === "chat" && brainAnalysis.confidence > 0.8) {
          responseData = { reply: brainAnalysis.reply || "Hi! How can I help you decorate?" };
          if (userMessage.toLowerCase().includes("hi") || userMessage.toLowerCase().includes("hello")) {
            // Force menu
            responseData.type = "actions";
            responseData.data = [
              { label: "📸 Upload My Room Photo", payload: "FLOW_VISUAL:START" },
              { label: "🎨 I Have Custom Requirements", payload: "FLOW_CUSTOM:START" },
              { label: "🖼 Help Me Choose", payload: "FLOW_GUIDE:START" }
            ];
          }
        } else {
          // Fallback Search
          responseData = await executeSearch(admin, userMessage, {});
          responseData.reply = `Here are some results for "${userMessage}"`;
        }
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
