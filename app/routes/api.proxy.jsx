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
          reply: "I'll help you choose something stunning \u2728\nWhat kind of paintings are you looking for?",
          voiceText: "I'll help you choose something stunning! We have 6 exciting categories for you. Vastu Friendly paintings for positive energy, Zodiac Sign paintings matched to your star sign, Color based search to match your room, different artistic Styles and Vibes, Subjects like Buddha, Nature, or Ganesha, and you can also Shop by Room type. Which one interests you?",
          type: "actions",
          data: [
            { label: "\ud83e\udded Vastu Friendly", payload: "FLOW_GUIDE:VASTU" },
            { label: "\u2728 Zodiac Signs", payload: "FLOW_GUIDE:ZODIAC" },
            { label: "\ud83c\udf08 Pick by Color", payload: "FLOW_GUIDE:COLORS" },
            { label: "\ud83c\udfa8 Styles & Vibes", payload: "FLOW_GUIDE:STYLES" },
            { label: "\ud83d\udd4a\ufe0f Subjects & Themes", payload: "FLOW_GUIDE:SUBJECTS" },
            { label: "\ud83c\udfe0 Shop by Room", payload: "FLOW_GUIDE:ROOMS" }
          ]
        };
      }

      else if (step === "VASTU") {
        responseData = {
          reply: "Great! Which direction does your wall face?",
          voiceText: "Great choice! I'll show you Vastu friendly paintings. We have 4 types of Vastu wall art based on directions. North wall paintings bring Wealth and Water energy. South wall paintings attract Fame and Fire energy. East wall paintings boost Health and Air energy. And West wall paintings enhance Gains and Space energy. You can also see all our Vastu paintings together. Which direction does your wall face?",
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

      else if (step === "ZODIAC") {
        responseData = {
          reply: "Select your Zodiac sign to find art that resonates with your energy \ud83c\udf1f",
          voiceText: "Let's find art that matches your zodiac energy! I have paintings for all 12 zodiac signs. Aries, Taurus, Gemini, Cancer, Leo, Virgo, Libra, Scorpio, Sagittarius, Capricorn, Aquarius, and Pisces. Each sign has specially curated artwork. Just select your sign!",
          type: "actions",
          data: [
            { label: "\u2648 Aries", payload: "FLOW_GUIDE:SEARCH:tag:ARIES" },
            { label: "\u2649 Taurus", payload: "FLOW_GUIDE:SEARCH:tag:TAURUS" },
            { label: "\u264a Gemini", payload: "FLOW_GUIDE:SEARCH:tag:GEMINI" },
            { label: "\u264b Cancer", payload: "FLOW_GUIDE:SEARCH:tag:CANCER" },
            { label: "\u264c Leo", payload: "FLOW_GUIDE:SEARCH:tag:LEO" },
            { label: "\u264d Virgo", payload: "FLOW_GUIDE:SEARCH:tag:VIRGO" },
            { label: "\u264e Libra", payload: "FLOW_GUIDE:SEARCH:tag:LIBRA" },
            { label: "\u264f Scorpio", payload: "FLOW_GUIDE:SEARCH:tag:SCORPIO" },
            { label: "\u2650 Sagittarius", payload: "FLOW_GUIDE:SEARCH:tag:SAGITTARIUS" },
            { label: "\u2651 Capricorn", payload: "FLOW_GUIDE:SEARCH:tag:CAPRICORN" },
            { label: "\u2652 Aquarius", payload: "FLOW_GUIDE:SEARCH:tag:AQUARIUS" },
            { label: "\u2653 Pisces", payload: "FLOW_GUIDE:SEARCH:tag:PISCES" }
          ]
        };
      }

      else if (step === "COLORS") {
        responseData = {
          reply: "What color palette fits your space? \ud83c\udfa8",
          voiceText: "Let's find paintings by color! We have beautiful options in Gold and Yellow tones, Blue and Navy shades, Red and Pink hues, fresh Greens, earthy Browns, elegant White and Silver, bold Black, and vibrant Colorful splash art. Pick a color that matches your room!",
          type: "actions",
          data: [
            { label: "\ud83d\udfe1 Gold/Yellow", payload: "FLOW_GUIDE:SEARCH:tag:Gold OR tag:Yellow" },
            { label: "\ud83d\udd35 Blue/Navy", payload: "FLOW_GUIDE:SEARCH:tag:Blue OR tag:Navy" },
            { label: "\ud83d\udd34 Red/Pink", payload: "FLOW_GUIDE:SEARCH:tag:Red OR tag:Pink" },
            { label: "\ud83d\udfe2 Green", payload: "FLOW_GUIDE:SEARCH:tag:Green" },
            { label: "\ud83d\udfe4 Brown/Wood", payload: "FLOW_GUIDE:SEARCH:tag:Brown" },
            { label: "\u26aa White/Silver", payload: "FLOW_GUIDE:SEARCH:tag:White OR tag:Silver" },
            { label: "\u26ab Black", payload: "FLOW_GUIDE:SEARCH:tag:Black" },
            { label: "\ud83c\udf08 Colorful/Splash", payload: "FLOW_GUIDE:SEARCH:tag:Colorful OR tag:color splash" }
          ]
        };
      }

      else if (step === "STYLES") {
        responseData = {
          reply: "Choose an artistic style or vibe:",
          voiceText: "Now let's pick an artistic style! You can choose from Abstract and Modern art, Vintage and Classic pieces, beautiful Watercolor paintings, clean Minimalism, futuristic Cyberpunk art, Calm and Serene paintings for peaceful vibes, or Energetic and Dynamic art for bold statements. What style speaks to you?",
          type: "actions",
          data: [
            { label: "\u2747\ufe0f Abstract & Modern", payload: "FLOW_GUIDE:SEARCH:tag:Abstract OR tag:Modern" },
            { label: "\ud83d\udd70\ufe0f Vintage & Classic", payload: "FLOW_GUIDE:SEARCH:tag:Vintage OR tag:traditional painting" },
            { label: "\ud83d\udd8c\ufe0f Watercolor & Painterly", payload: "FLOW_GUIDE:SEARCH:tag:Watercolor" },
            { label: "\u2796 Minimalism", payload: "FLOW_GUIDE:SEARCH:tag:Minimalism" },
            { label: "\ud83c\udf06 Cyberpunk/Futuristic", payload: "FLOW_GUIDE:SEARCH:tag:Cyberpunk OR tag:Futuristic" },
            { label: "\ud83d\ude0c Calm & Serene", payload: "FLOW_GUIDE:SEARCH:tag:Serenity OR tag:Tranquility" },
            { label: "\ud83d\udd25 Energetic & Dynamic", payload: "FLOW_GUIDE:SEARCH:tag:Energetic OR tag:Positive Energy" }
          ]
        };
      }

      else if (step === "SUBJECTS") {
        responseData = {
          reply: "What subject are you most interested in?",
          voiceText: "Let me show you paintings by subject! We have peaceful Buddha paintings, divine Lord Ganesha art, spiritual Shiva and Krishna paintings, beautiful Nature and Landscape sceneries, stunning Cityscapes and Travel art, lovely Birds and Animal paintings, and romantic Love themed artwork. What catches your eye?",
          type: "actions",
          data: [
            { label: "\ud83e\udeb7 Buddha", payload: "FLOW_GUIDE:SEARCH:tag:Buddha" },
            { label: "\ud83d\udc18 Lord Ganesha", payload: "FLOW_GUIDE:SEARCH:tag:Ganesha" },
            { label: "\ud83d\udd49\ufe0f Shiva & Krishna", payload: "FLOW_GUIDE:SEARCH:tag:Shiva OR tag:Krishna" },
            { label: "\ud83c\udf3f Nature & Landscapes", payload: "FLOW_GUIDE:SEARCH:tag:Landscape OR tag:Nature" },
            { label: "\ud83c\udfd9\ufe0f Cityscapes & Travel", payload: "FLOW_GUIDE:SEARCH:tag:Cityscape OR tag:travel art" },
            { label: "\ud83e\udd85 Birds & Animals", payload: "FLOW_GUIDE:SEARCH:tag:Bird OR tag:Animal" },
            { label: "\u2764\ufe0f Love & Romance", payload: "FLOW_GUIDE:SEARCH:tag:romantic" }
          ]
        };
      }

      else if (step === "ROOMS") {
        responseData = {
          reply: "Which room are you decorating?",
          voiceText: "Let's find the perfect painting for your room! You can browse our curated collections for the Living Room, Bedroom, Hotel spaces, Kids Room with fun designs, Multiple Frame sets, our Best Sellers, and trendy Gen Z Art. Which room are you looking to decorate?",
          type: "actions",
          data: [
            { label: "\ud83d\udecb Living Room", payload: "FLOW_GUIDE:SEARCH:collection:'Living Room'" },
            { label: "\ud83d\udecf Bedroom", payload: "FLOW_GUIDE:SEARCH:collection:'Bedroom'" },
            { label: "\ud83c\udfe8 Hotel", payload: "FLOW_GUIDE:SEARCH:collection:'Hotel'" },
            { label: "\ud83e\uddd2 Kids Room", payload: "FLOW_GUIDE:SEARCH:collection:'Kids Room'" },
            { label: "\ud83d\uddbc Multiple Frames", payload: "FLOW_GUIDE:SEARCH:collection:'Multiple Frames'" },
            { label: "\u2b50 Best Sellers", payload: "FLOW_GUIDE:SEARCH:collection:'Best Sellers'" },
            { label: "\ud83c\udfa8 Gen Z Art", payload: "FLOW_GUIDE:SEARCH:collection:'Gen Z Art'" }
          ]
        };
      }

      else if (step === "SEARCH") {
        const query = parts.slice(2).join(":");
        const searchResult = await executeSearch(admin, query, {});

        // Determine context-aware follow-up actions based on the query that was passed
        let followUpActions = [
          { label: "Under ₹5000 💰", payload: `FLOW_GUIDE:REFINE:${query}:BUDGET` },
          { label: "Try Different Category 🔄", payload: "FLOW_GUIDE:START" }
        ];

        // Specific context clues
        if (query.includes("tag:ARIES") || query.includes("TAURUS")) {
          followUpActions.unshift({ label: "Try Different Zodiac ✨", payload: "FLOW_GUIDE:ZODIAC" });
        } else if (query.includes("tag:Red") || query.includes("Blue") || query.includes("Color")) {
          followUpActions.unshift({ label: "Try Another Color 🌈", payload: "FLOW_GUIDE:COLORS" });
        } else if (query.includes("tag:Abstract") || query.includes("Vintage")) {
          followUpActions.unshift({ label: "Try Another Style 🎨", payload: "FLOW_GUIDE:STYLES" });
        } else if (query.includes("tag:Buddha") || query.includes("Nature")) {
          followUpActions.unshift({ label: "Try Different Subject 🕊️", payload: "FLOW_GUIDE:SUBJECTS" });
        } else if (query.includes("collection")) {
          followUpActions.unshift({ label: "Browse Another Room 🏠", payload: "FLOW_GUIDE:ROOMS" });
        }

        responseData = {
          reply: `Here are our best matching picks for you! \u2728\n\nTo explore further, what would you like to do?`,
          voiceText: `Here are our best matching picks for you! I've highlighted the top result in the chat, and added more options to the sidebar. You can refine by budget, or try a completely different category.`,
          type: "carousel",
          carousel: searchResult.data || [],
          actions: followUpActions
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
          reply: `Perfect! I've refined the results for you. ✨\n\nShall we keep exploring?`,
          type: "carousel",
          carousel: searchResult.data || [],
          actions: [
            { label: "Try A New Search 🔄", payload: `FLOW_GUIDE:START` },
            { label: "📸 Upload Room Photo", payload: "FLOW_VISUAL:START" }
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

    // 1. (Removed hardcoded Vastu logic to allow pure tag searching)

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
    if (matchedCollection && isCollection) {
      console.log("FUZZY MATCH SUCCESS! Found Collection ID:", matchedCollection.node.id, "for", textQuery);
      const response = await admin.graphql(
        `#graphql
          query ($colId: ID!) {
            collection(id: $colId) {
              products(first: 20) {
                edges {
                  node {
                    id title handle description(truncateAt: 100) productType vendor tags
                    variants(first: 1) { edges { node { id, price } } }
                    featuredImage { url }
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

    // 4. FALLBACK TO FREEFORM TEXT SEARCH (or Tag search)
    if (products.length === 0 && (!isCollection || isTag)) {
      console.log("FALLING BACK TO STORE SEARCH FOR:", textQuery, isTag ? "(Exact Tag Mode)" : "");

      let finalQuery = "";
      if (isTag) {
        finalQuery = `tag:'${textQuery}'`;
      } else {
        finalQuery = textQuery.split(' ').filter(w => w.trim().length > 2).map(w => `(title:${w}* OR tag:${w}*)`).join(' AND ');
      }

      if (!finalQuery) finalQuery = "title:''";

      const response = await admin.graphql(
        `#graphql
          query ($query: String!) {
            products(first: 20, query: $query) {
              edges {
                node {
                  id title handle description(truncateAt: 100) productType vendor tags
                  variants(first: 1) { edges { node { id, price } } }
                  featuredImage { url }
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
                  variants(first: 1) { edges { node { id, price } } }
                  featuredImage { url }
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
        const priceStr = p.variants?.edges?.[0]?.node?.price || "0";
        const price = parseFloat(priceStr);
        if (budget === "Low") return price >= 999 && price <= 1999;
        if (budget === "Mid") return price >= 2000 && price <= 5000;
        if (budget === "High") return price > 5000;
        return true;
      });
    }

    products = products.slice(0, 10);

    const carouselData = products.map(node => ({
      title: node.title,
      price: node.variants?.edges?.[0]?.node?.price ? `₹${node.variants.edges[0].node.price}` : "Price N/A",
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
