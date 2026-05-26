import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session, cors } = await authenticate.public.appProxy(request);

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  return Response.json(
    { status: "ok", message: "Art Assistant Cognitive Agent API Ready" },
    { headers: cors?.headers || {} }
  );
};

export const action = async ({ request }) => {
  try {
    const { session, admin, cors } = await authenticate.public.appProxy(request);

    if (!session) {
      return Response.json(
        { reply: "Error: Unauthorized (Session invalid)" },
        { headers: cors?.headers || {} }
      );
    }

    const payload = await request.json();
    let userMessage = (payload.message || "").trim();
    const userImage = payload.image; // Base64 image
    const payloadTag = payload.payload; // From button clicks

    // Import Prisma & Services
    const { default: prisma } = await import("../db.server");
    const { AntigravityBrain } = await import("../services/brain.server");
    const { ProductSyncService } = await import("../services/sync.server");

    // Fetch API Key from Settings
    const apiKeyObj = await prisma.appSetting.findUnique({ where: { key: "GEMINI_API_KEY" } });
    const apiKey = (apiKeyObj?.value || process.env.GEMINI_API_KEY || "").trim();

    // Trigger an asynchronous/lazy catalog vector sync in the background if empty
    const vectorCount = await prisma.productEmbedding.count();
    if (vectorCount === 0 && apiKey) {
        console.log("⚡ Vector database is empty. Lazy-triggering auto-sync in background...");
        ProductSyncService.syncAll(admin, apiKey).catch(err => {
            console.error("Lazy sync failed:", err);
        });
    }

    const sessionId = session.id;

    // --- 1. RESET / INITIAL FLOWS ---
    if (userMessage.toLowerCase() === "hi" || userMessage.toLowerCase() === "hello" || userMessage === "RESET_FLOW" || payloadTag === "RESET_FLOW") {
      // Clear user agent session state
      await prisma.agentSession.upsert({
        where: { id: sessionId },
        update: {
          roomType: null,
          colorPalette: null,
          moodVibe: null,
          wallSize: null,
          collectedState: "INTERVIEWING",
          rawHistoryJson: "[]"
        },
        create: {
          id: sessionId,
          collectedState: "INTERVIEWING",
          rawHistoryJson: "[]"
        }
      });

      return Response.json({
        reply: "Hi 👋\nLet’s find the perfect painting for your space.\n\nWhat would you like to do?",
        type: "actions",
        data: [
          { label: "📸 Upload My Room Photo", payload: "FLOW_VISUAL:START" },
          { label: "🖼 Help Me Choose", payload: "FLOW_GUIDE:START" }
        ]
      }, { headers: cors?.headers || {} });
    }

    // --- 2. BACKWARD COMPATIBILITY: TRANSLATE LEGACY BUTTON PAYLOADS INTO NATURAL LANGUAGE ---
    let activeMessage = userMessage;

    if (payloadTag) {
      console.log(`🔌 Translating legacy payload tag: "${payloadTag}"`);

      if (payloadTag === "FLOW_VISUAL:START") {
        return Response.json({
          reply: "Please upload a clear photo of your room wall. 📸",
          type: "actions",
          data: []
        }, { headers: cors?.headers || {} });
      }

      if (payloadTag === "FLOW_GUIDE:START") {
        return Response.json({
          reply: "I'll help you choose something stunning ✨\nWhat kind of paintings are you looking for?",
          type: "actions",
          data: [
            { label: "🧭 Vastu Friendly", payload: "FLOW_GUIDE:VASTU" },
            { label: "✨ Zodiac Signs", payload: "FLOW_GUIDE:ZODIAC" },
            { label: "🌈 Pick by Color", payload: "FLOW_GUIDE:COLORS" },
            { label: "🎨 Styles & Vibes", payload: "FLOW_GUIDE:STYLES" },
            { label: "🕊️ Subjects & Themes", payload: "FLOW_GUIDE:SUBJECTS" },
            { label: "🛋️ Shop by Room", payload: "FLOW_GUIDE:ROOMS" }
          ]
        }, { headers: cors?.headers || {} });
      }

      // Vastu guides
      if (payloadTag === "FLOW_GUIDE:VASTU") {
        return Response.json({
          reply: "Great! Which direction does your wall face?",
          type: "actions",
          data: [
            { label: "North (Wealth/Water)", payload: "FLOW_GUIDE:SEARCH:tag:Vastu-North" },
            { label: "South (Fame/Fire)", payload: "FLOW_GUIDE:SEARCH:tag:Vastu-South" },
            { label: "East (Health/Air)", payload: "FLOW_GUIDE:SEARCH:tag:Vastu-East" },
            { label: "West (Gains/Space)", payload: "FLOW_GUIDE:SEARCH:tag:Vastu-West" }
          ]
        }, { headers: cors?.headers || {} });
      }

      // Zodiac guides
      if (payloadTag === "FLOW_GUIDE:ZODIAC") {
        return Response.json({
          reply: "Select your Zodiac sign to find art that resonates with your energy 🌟",
          type: "actions",
          data: [
            { label: "Aries ♈", payload: "FLOW_GUIDE:SEARCH:tag:ARIES" },
            { label: "Taurus ♉", payload: "FLOW_GUIDE:SEARCH:tag:TAURUS" },
            { label: "Gemini ♊", payload: "FLOW_GUIDE:SEARCH:tag:GEMINI" },
            { label: "Cancer ♋", payload: "FLOW_GUIDE:SEARCH:tag:CANCER" },
            { label: "Leo ♌", payload: "FLOW_GUIDE:SEARCH:tag:LEO" },
            { label: "Virgo ♍", payload: "FLOW_GUIDE:SEARCH:tag:VIRGO" },
            { label: "Libra ♎", payload: "FLOW_GUIDE:SEARCH:tag:LIBRA" },
            { label: "Scorpio ♏", payload: "FLOW_GUIDE:SEARCH:tag:SCORPIO" },
            { label: "Sagittarius ♐", payload: "FLOW_GUIDE:SEARCH:tag:SAGITTARIUS" },
            { label: "Capricorn ♑", payload: "FLOW_GUIDE:SEARCH:tag:CAPRICORN" },
            { label: "Aquarius ♒", payload: "FLOW_GUIDE:SEARCH:tag:AQUARIUS" },
            { label: "Pisces ♓", payload: "FLOW_GUIDE:SEARCH:tag:PISCES" }
          ]
        }, { headers: cors?.headers || {} });
      }

      // Room Type guides
      if (payloadTag === "FLOW_GUIDE:ROOMS") {
        return Response.json({
          reply: "Which room are you decorating?",
          type: "actions",
          data: [
            { label: "Living Room 🛋️", payload: "FLOW_GUIDE:SEARCH:collection:Living-Room" },
            { label: "Bedroom 🛏️", payload: "FLOW_GUIDE:SEARCH:collection:Bedroom" },
            { label: "Office 🖥️", payload: "FLOW_GUIDE:SEARCH:collection:Office" }
          ]
        }, { headers: cors?.headers || {} });
      }

      // Color Palette guides
      if (payloadTag === "FLOW_GUIDE:COLORS") {
        return Response.json({
          reply: "What color palette fits your space? 🎨",
          type: "actions",
          data: [
            { label: "Gold/Yellow 💛", payload: "FLOW_GUIDE:SEARCH:tag:Yellow" },
            { label: "Blue/Navy 💙", payload: "FLOW_GUIDE:SEARCH:tag:Blue" },
            { label: "Red/Pink ❤️", payload: "FLOW_GUIDE:SEARCH:tag:Red" },
            { label: "Green 💚", payload: "FLOW_GUIDE:SEARCH:tag:Green" }
          ]
        }, { headers: cors?.headers || {} });
      }

      // Translate specific selections to natural language
      if (payloadTag.startsWith("FLOW_GUIDE:SEARCH:")) {
        const queryPart = payloadTag.replace("FLOW_GUIDE:SEARCH:", "");
        if (queryPart.includes("tag:Vastu-")) {
          const dir = queryPart.split("-")[1];
          activeMessage = `I want to search for Vastu friendly paintings facing ${dir}`;
        } else if (queryPart.includes("tag:")) {
          const tag = queryPart.split("tag:")[1];
          activeMessage = `Show me artworks with style or tag ${tag}`;
        } else if (queryPart.includes("collection:")) {
          const col = queryPart.split("collection:")[1];
          activeMessage = `Show me curated paintings from the ${col.replace("-", " ")} collection`;
        }
      }

      // Translate color/theme selections from room upload flows
      if (payloadTag.startsWith("FLOW_VISUAL:COLOR:")) {
        const color = payloadTag.split(":")[3];
        activeMessage = `I prefer the ${color} color palette.`;
      }
      if (payloadTag.startsWith("FLOW_VISUAL:THEME:")) {
        const theme = payloadTag.split(":")[4];
        activeMessage = `I like the ${theme} theme.`;
      }
      if (payloadTag.startsWith("FLOW_VISUAL:REFINE:")) {
        const refine = payloadTag.split(":")[5];
        if (refine === "VASTU") activeMessage = "Can we refine the results to be Vastu friendly?";
        if (refine === "BUDGET_LOW") activeMessage = "Show me budget options under ₹2000.";
        if (refine === "BUDGET_HIGH") activeMessage = "Show me premium luxury options.";
      }
    }

    // --- 3. MULTIMODAL IMAGE UPLOAD (SENSORY PRE-PROCESSOR) ---
    if (userImage) {
      if (!apiKey) {
        return Response.json({
          reply: "I need a Gemini API Key to analyze images. Please add it in the Admin Dashboard."
        }, { headers: cors?.headers || {} });
      }

      console.log("📸 Pre-processing uploaded room photo via Gemini Vision...");
      
      try {
        const { GoogleGenerativeAI } = await import("@google/generative-ai");
        const genAI = new GoogleGenerativeAI(apiKey);

        const mimeTypeMatch = userImage.match(/[^:]\w+\/[\w-+\d.]+(?=;|,)/);
        const mimeType = mimeTypeMatch ? mimeTypeMatch[0] : "image/jpeg";
        const base64Data = userImage.replace(/^data:image\/\w+;base64,/, "");

        const imagePart = {
          inlineData: { data: base64Data, mimeType }
        };

        const prompt = `You are an expert interior designer. Analyze this room and strictly return a JSON object with:
1. "description": A 1-sentence description of the room (e.g. "a modern sunlit living room with neutral walls").
2. "room_type": One of: "Living Room", "Bedroom", "Office", "Dining Room".
3. "inferred_colors": The dominant color tones in the room (e.g. "Neutrals", "Blues", "Warm Golds").
Return ONLY the raw JSON. No markdown formatting.`;

        let result;
        const modelsToTry = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
        let visionError = null;

        for (const modelName of modelsToTry) {
          try {
            console.log(`📸 Attempting Vision analysis with model: ${modelName}`);
            const model = genAI.getGenerativeModel({ model: modelName });
            result = await model.generateContent([prompt, imagePart]);
            break; // Success!
          } catch (err) {
            console.warn(`⚠️ Vision model ${modelName} failed:`, err.message);
            visionError = err;
          }
        }

        if (!result) {
          throw new Error(`All vision models failed. Last error: ${visionError?.message}`);
        }
        let responseText = result.response.text().trim();
        if (responseText.startsWith("```json")) {
          responseText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
        }
        
        const analysis = JSON.parse(responseText);
        console.log("📸 Vision pre-processor results:", analysis);

        // Save vision parameters directly to the Agent Session database
        await prisma.agentSession.upsert({
          where: { id: sessionId },
          update: {
            roomType: analysis.room_type,
            colorPalette: analysis.inferred_colors,
            collectedState: "INTERVIEWING"
          },
          create: {
            id: sessionId,
            roomType: analysis.room_type,
            colorPalette: analysis.inferred_colors,
            collectedState: "INTERVIEWING"
          }
        });

        // Formulate natural language prompt for the ReAct interviewer agent
        activeMessage = `I uploaded a photo of my room. It is ${analysis.description}. The dominant colors are ${analysis.inferred_colors}. Please recommend artwork for this space.`;

        // Save image record in Admin gallery
        await prisma.customerImage.create({
          data: { 
            imageData: userImage.substring(0, 100) + "...", 
            analysisResult: analysis.description 
          }
        }).catch(err => console.error("Could not save image to gallery:", err));

      } catch (err) {
        console.error("📸 Vision pre-processing failed:", err);
        activeMessage = "I have uploaded a photo of my room. What paintings would you recommend?";
      }
    }

    // --- 4. ROUTE TO REACT AGENT ---
    console.log(`🚀 Routing text input to ReAct Agent: "${activeMessage}"`);
    const agentResponse = await AntigravityBrain.process(activeMessage, sessionId, admin, apiKey);

    // Formulate final response structure for storefront chat widget
    const buttons = agentResponse.action ? [
      { label: "Vastu Advice 🧭", payload: "FLOW_GUIDE:VASTU" },
      { label: "Change Colors 🌈", payload: "FLOW_GUIDE:COLORS" },
      { label: "Start Over 🏠", payload: "RESET_FLOW" }
    ] : [
      { label: "📸 Upload My Room Photo", payload: "FLOW_VISUAL:START" },
      { label: "🖼 Help Me Choose", payload: "FLOW_GUIDE:START" },
      { label: "Start Over 🏠", payload: "RESET_FLOW" }
    ];

    const finalResponse = {
      reply: agentResponse.reply,
      type: agentResponse.action ? "carousel" : "actions",
      carousel: agentResponse.action?.data || [],
      actions: buttons,
      data: buttons // Set both keys for absolute compatibility with different widget parsing versions
    };

    return Response.json(finalResponse, { headers: cors?.headers || {} });

  } catch (error) {
    console.error("❌ Proxy Error:", error);
    return Response.json({
      reply: `I'm having a little trouble connecting right now. Please try again. (Error: ${error.message})`
    }, { status: 200, headers: { "Access-Control-Allow-Origin": "*" } });
  }
};
