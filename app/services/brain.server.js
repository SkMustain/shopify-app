import { GoogleGenerativeAI } from "@google/generative-ai";
import prisma from "../db.server.js";

export const AntigravityBrain = {

    /**
     * Core Entry Point: Processes user inputs through a tool-driven Reasoning Loop (ReAct).
     * Automatically extracts preferences, queries the vector database, and curates products.
     */
    async process(textInput, sessionId, admin, apiKey) {
        const text = String(textInput || "").trim();
        console.log(`🧠 AntigravityBrain v5.0 (ReAct Agent) processing session [${sessionId}]: "${text.slice(0, 30)}..."`);

        // --- 1. API KEY CHECK ---
        if (!apiKey) {
            console.warn("⚠️ No API Key provided. Entering Resilient Safe Mode.");
            return this.getResilientResponse(admin, text);
        }

        const genAI = new GoogleGenerativeAI(apiKey);

        // --- 2. RETRIEVE OR INITIALIZE SESSION STATE ---
        let session = await prisma.agentSession.findUnique({
            where: { id: sessionId }
        });

        if (!session) {
            session = await prisma.agentSession.create({
                data: {
                    id: sessionId,
                    collectedState: "INTERVIEWING",
                    rawHistoryJson: "[]"
                }
            });
        }

        // Parse previous conversation history
        let history = [];
        try {
            history = JSON.parse(session.rawHistoryJson || "[]");
        } catch (e) {
            history = [];
        }

        // Add user's latest message to history
        history.push({ role: "user", message: text });

        // --- 3. DEFINE TOOLS & FUNCTION SCHEMAS ---
        const tools = [{
            functionDeclarations: [
                {
                    name: "save_customer_preferences",
                    description: "Save extracted customer interior design preferences. Call this as soon as you identify roomType, colorPalette, moodVibe, or wallSize in the conversation.",
                    parameters: {
                        type: "OBJECT",
                        properties: {
                            roomType: { type: "STRING", description: "e.g. Living Room, Bedroom, Office, Pooja Room" },
                            colorPalette: { type: "STRING", description: "e.g. Cool Blues, Warm Earth Tones, Bold Gold, Minimalist White" },
                            moodVibe: { type: "STRING", description: "e.g. Calming, Energetic, Devotional, Introspective, Modern" },
                            wallSize: { type: "STRING", description: "e.g. Small, Medium, Large, Wide" }
                        }
                    }
                },
                {
                    name: "search_vector_database",
                    description: "Perform a semantic vector database search to find paintings in the store catalog matching a descriptive art style, color, or vibe.",
                    parameters: {
                        type: "OBJECT",
                        properties: {
                            query: { type: "STRING", description: "Detailed search query (e.g. 'calm blue abstract bedroom canvas painting')" }
                        },
                        required: ["query"]
                    }
                },
                {
                    name: "get_vastu_rules",
                    description: "Get Vastu Shastra rules, elemental colors, and themes for a compass direction.",
                    parameters: {
                        type: "OBJECT",
                        properties: {
                            direction: { type: "STRING", description: "Compass direction (e.g. North, South, East, West, North-East)" }
                        },
                        required: ["direction"]
                    }
                }
            ]
        }];

        // System prompt for the ReAct Interviewer
        const systemPrompt = `You are the "Art Assistant", an elite interior design consultant.
YOUR GOAL: Guide the customer warm-heartedly to help them find the *perfect* painting for their room.

We have a 4-parameter checklist we need to collect before we can run a high-quality curation search:
1. Room Type (e.g., Living Room, Office, Bedroom)
2. Color Palette Preference (e.g., Warm Golds, Cool Blues, Greens)
3. Mood/Vibe (e.g., Calming, Spiritual/Devotional, Bold & Energetic, Introspective)
4. Wall Size (e.g., Small, Medium, Large)

🛑 CRITICAL RULE: DO NOT search or curate products unless you have gathered at least 3 of these 4 parameters!
If you have collected less than 3, you MUST call 'save_customer_preferences' with any newly extracted details, and then ask a warm, highly-personalized clarifying question to gather the remaining information.

CURRENT PREFERENCES ALREADY GATHERED:
* Room Type: ${session.roomType || "Not specified yet"}
* Color Palette: ${session.colorPalette || "Not specified yet"}
* Mood/Vibe: ${session.moodVibe || "Not specified yet"}
* Wall Size: ${session.wallSize || "Not specified yet"}

If the user asks about Vastu, call 'get_vastu_rules' to retrieve elemental guidance for that direction.
Once you have collected 3 or more preferences, call 'search_vector_database' with a highly descriptive search query representing their combined space needs (e.g., 'calm blue abstract bedroom landscape painting').

TONE: Elegant, warm, artistic, and friendly. Use emojis (✨, 🎨, 🛋️). Do not output markdown blocks for your tool calls.`;

        // Attempt Gemini 2.0 Flash Reasoning Loop
        try {
            const model = genAI.getGenerativeModel({ 
                model: "gemini-2.0-flash", 
                tools, 
                systemInstruction: systemPrompt 
            });

            const chat = model.startChat({
                history: history.slice(0, -1).map(h => ({
                    role: h.role === 'bot' ? 'model' : 'user',
                    parts: [{ text: h.message }]
                }))
            });

            const result = await chat.sendMessage(text);
            const response = result.response;
            const functionCall = response.functionCalls()?.[0];

            // --- 4. REACT AGENT FUNCTION CALL HANDLING ---
            if (functionCall) {
                console.log(`🤖 ReAct Tool Invocation: "${functionCall.name}"`, functionCall.args);

                // A. Handle: Save Preferences
                if (functionCall.name === "save_customer_preferences") {
                    const args = functionCall.args;
                    session = await prisma.agentSession.update({
                        where: { id: sessionId },
                        data: {
                            roomType: args.roomType || session.roomType,
                            colorPalette: args.colorPalette || session.colorPalette,
                            moodVibe: args.moodVibe || session.moodVibe,
                            wallSize: args.wallSize || session.wallSize
                        }
                    });

                    // Count how many parameters we have now
                    const paramCount = [session.roomType, session.colorPalette, session.moodVibe, session.wallSize].filter(Boolean).length;

                    if (paramCount >= 3) {
                        // If we hit the threshold, immediately execute vector search on their behalf
                        const searchQuery = `${session.moodVibe || ""} ${session.colorPalette || ""} ${session.roomType || ""} painting`.trim();
                        console.log(`🚀 Preferences threshold reached (${paramCount}/4). Auto-triggering vector search: "${searchQuery}"`);
                        return await this.executeSemanticSearchAndCuration(genAI, admin, apiKey, session, searchQuery, history);
                    }

                    // Otherwise, send preference confirmation back to model to get its conversational follow-up
                    const toolResponse = { status: "preferences_saved", current: { roomType: session.roomType, colorPalette: session.colorPalette, moodVibe: session.moodVibe, wallSize: session.wallSize } };
                    const followupResult = await chat.sendMessage([
                        { text: `[Tool Output: Preferences saved successfully. Current state: ${JSON.stringify(toolResponse)}] Please continue the interview and ask the user for one of the missing parameters.` }
                    ]);

                    const botReply = followupResult.response.text();
                    history.push({ role: "bot", message: botReply });
                    await this.saveHistory(sessionId, history);

                    return { reply: botReply, intent: "chat" };
                }

                // B. Handle: Vastu Rules Query
                if (functionCall.name === "get_vastu_rules") {
                    const direction = functionCall.args.direction;
                    const vastuAdvice = this.localVastuAdvice(direction);

                    // Send Vastu details back to the agent to formulate the pitch
                    const followupResult = await chat.sendMessage([
                        { text: `[Tool Output: Vastu details for ${direction} are: ${JSON.stringify(vastuAdvice)}]. Explain these guidelines to the user, and if you have 3 parameters, offer to search; otherwise, ask a clarifying question.` }
                    ]);

                    // Log log to DB
                    await prisma.vastuLog.create({
                        data: { direction: direction, query: text }
                    });

                    const botReply = followupResult.response.text();
                    history.push({ role: "bot", message: botReply });
                    await this.saveHistory(sessionId, history);

                    return { reply: botReply, intent: "vastu_consult" };
                }

                // C. Handle: Vector Catalog Search & Curation (The Critic)
                if (functionCall.name === "search_vector_database") {
                    const searchQuery = functionCall.args.query;
                    return await this.executeSemanticSearchAndCuration(genAI, admin, apiKey, session, searchQuery, history);
                }
            }

            // Normal conversational reply (no tool called)
            const botReply = response.text();
            history.push({ role: "bot", message: botReply });
            await this.saveHistory(sessionId, history);

            return { reply: botReply, intent: "chat" };

        } catch (e) {
            console.error("❌ ReAct Agent Exception. Switching to Resilient Mode...", e);
            return this.getResilientResponse(admin, text);
        }
    },

    /**
     * Executes semantic pgvector search followed by Gemini Curator/Critic curation.
     */
    async executeSemanticSearchAndCuration(genAI, admin, apiKey, session, searchQuery, history) {
        console.log(`🔎 Executing Vector Semantic Search for: "${searchQuery}"`);

        try {
            // 1. Generate Query Vector Embedding via Gemini
            const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
            const embedResult = await embedModel.embedContent(searchQuery);
            const queryEmbedding = embedResult.embedding?.values;

            if (!queryEmbedding) throw new Error("Could not generate query embedding.");

            // 2. Fetch all stored embeddings from the database
            const allEmbeddings = await prisma.productEmbedding.findMany();

            if (!allEmbeddings || allEmbeddings.length === 0) {
                console.warn("⚠️ Vector database is empty. Falling back to text search.");
                const fallbackProducts = await this.executeShopifyGraphQLSearch(admin, searchQuery);
                return {
                    reply: `I searched our catalog for "${searchQuery}"! Here are some beautiful options we have in stock: 👇`,
                    action: { type: "carousel", data: fallbackProducts },
                    intent: "product_search"
                };
            }

            // 3. Compute cosine similarity in memory (extremely fast and lightweight for Shopify catalogs!)
            const dotProduct = (a, b) => a.reduce((sum, val, i) => sum + val * b[i], 0);
            const magnitude = (arr) => Math.sqrt(arr.reduce((sum, val) => sum + val * val, 0));
            const calcCosineSimilarity = (a, b) => {
                const magA = magnitude(a);
                const magB = magnitude(b);
                if (magA === 0 || magB === 0) return 0;
                return dotProduct(a, b) / (magA * magB);
            };

            const scoredMatches = allEmbeddings.map(item => {
                try {
                    // Try parsing the stored JSON array
                    const parsedVector = JSON.parse(item.embedding);
                    const similarity = calcCosineSimilarity(parsedVector, queryEmbedding);
                    return { productId: item.productId, similarity, textPayload: item.textPayload };
                } catch (err) {
                    // Fallback in case of string parsing issues
                    return { productId: item.productId, similarity: 0, textPayload: item.textPayload };
                }
            });

            // Sort descending by similarity score and take top 20
            scoredMatches.sort((a, b) => b.similarity - a.similarity);
            const vectorMatches = scoredMatches.slice(0, 20);

            // 3. Fetch Full Product Objects from Shopify for matching product IDs
            const productIds = vectorMatches.map(m => m.productId);
            const candidates = await this.fetchShopifyProductsByIds(admin, productIds);

            if (candidates.length === 0) {
                throw new Error("Failed to load matching product objects from Shopify.");
            }

            // 4. THE CRITIC/THINKING CAP PHASE
            // Instruct Gemini 2.0 Flash to act as an elite curator, evaluate candidates, filter out 15, and pitches top 5.
            const curatorModel = genAI.getGenerativeModel({ 
                model: "gemini-2.0-flash",
                generationConfig: { responseMimeType: "application/json" }
            });

            const curatorPrompt = `You are an elite interior design art curator.
The client wants a painting matching this intent profile:
- Room: ${session.roomType || "Any"}
- Colors: ${session.colorPalette || "Any"}
- Vibe/Mood: ${session.moodVibe || "Any"}
- Size: ${session.wallSize || "Any"}

Here is a candidate list of 20 paintings from our vector catalog (including their full tags and details):
${JSON.stringify(candidates.map((c, idx) => ({
    idx: idx,
    id: c.id,
    title: c.title,
    description: c.description,
    tags: c.tags
})))}

YOUR TASK (Reasoning Loop):
1. Evaluate how the theme, description, and tags of each artwork fit the client's intent profile.
2. Eliminate 15 products that clash with the requested room, colors, or mood.
3. Select exactly the TOP 5 products.
4. For each of the top 5, write a highly persuasive custom 2-sentence pitch explaining exactly why it is perfect for their specific space.

Return STRICTLY a JSON object with this exact shape:
{
  "rationale": "A warm, artistic 1-2 sentence overall summary of your curation concept.",
  "selections": [
    {
      "productId": "Shopify product ID string",
      "pitch": "A highly tailored, persuasive 2-sentence pitch explaining why this painting matches their space constraints."
    }
  ]
}
Do not return any markdown blocks or outer strings. Just raw JSON.`;

            console.log("🧐 Triggering Critic/Curator Analysis on 20 candidates...");
            const curationResult = await curatorModel.generateContent(curatorPrompt);
            let rawCurationJson = curationResult.response.text().trim();
            if (rawCurationJson.startsWith("```json")) {
                rawCurationJson = rawCurationJson.replace(/```json/g, "").replace(/```/g, "").trim();
            }

            const curationData = JSON.parse(rawCurationJson);
            console.log("✨ Curator Curation Successful! Curated selections count:", curationData.selections?.length);

            // 5. Build final Carousel with the Custom Pitches appended
            const finalCuratedProducts = curationData.selections.map(selection => {
                const prod = candidates.find(c => c.id === selection.productId);
                if (!prod) return null;
                return {
                    title: prod.title,
                    price: prod.price,
                    image: prod.image,
                    url: prod.url,
                    variantId: prod.variantId,
                    vendor: prod.vendor,
                    pitch: selection.pitch // Inject custom AI Curator pitch!
                };
            }).filter(Boolean);

            // Update session collected state
            await prisma.agentSession.update({
                where: { id: session.id },
                data: { collectedState: "CURATED" }
            });

            // Update conversation history
            const botResponseText = `${curationData.rationale}\n\nHere are the top 5 masterfully curated paintings for your room: 👇`;
            history.push({ role: "bot", message: botResponseText });
            await this.saveHistory(session.id, history);

            return {
                reply: botResponseText,
                action: { type: "carousel", data: finalCuratedProducts },
                intent: "product_search"
            };

        } catch (error) {
            console.error("❌ Curation process failed. Falling back to keyword search.", error);
            const fallbackProducts = await this.executeShopifyGraphQLSearch(admin, searchQuery);
            return {
                reply: `I searched our database for "${searchQuery}"! Here are some beautiful options we have in stock: 👇`,
                action: { type: "carousel", data: fallbackProducts },
                intent: "product_search"
            };
        }
    },

    // --- SHARED HISTORY & PERSISTENCE ---
    async saveHistory(sessionId, history) {
        await prisma.agentSession.update({
            where: { id: sessionId },
            data: { rawHistoryJson: JSON.stringify(history) }
        });
    },

    // --- HELPER: VASTU ADVICE DICTIONARY ---
    localVastuAdvice(direction) {
        const rules = {
            "North": { recommendation: "Represented by Water and Wealth. Place blue waterfall scenes, flowing rivers, or calm seas to attract prosperity and career growth. Auspicious colors: Blue, Aqua.", keywords: "Water Blue" },
            "South": { recommendation: "Represented by Fire and Fame. Hang paintings of running red horses, sunrises, or fire elements to attract fame, success, and high energy. Auspicious colors: Red, Orange.", keywords: "Red Fire Horses" },
            "East": { recommendation: "Represented by Air and Social Growth. Choose green forests, blooming sunlit flora, or rising suns to boost family health and expand social connections. Auspicious colors: Green, Emerald.", keywords: "Green Forest Flora" },
            "West": { recommendation: "Represented by Space and Gains. Hang golden mountain peaks, white landscapes, or metal reliefs to enhance children's creativity and secure financial gains. Auspicious colors: White, Gold, Silver.", keywords: "Gold White Mountain" },
            "North-East": { recommendation: "Represented by Spiritual connection. Hang serene spiritual art, Lord Shiva/Adiyogi, or calm skies to foster deep spiritual growth and mental tranquility. Auspicious colors: Light Blue, Yellow.", keywords: "Shiva Spiritual Tranquil" }
        };
        const safeDir = String(direction || "North");
        const normDir = Object.keys(rules).find(k => safeDir.toLowerCase().includes(k.toLowerCase())) || "North";
        return rules[normDir];
    },

    // --- HELPER: FETCH SHOPIFY DETAILS BY VECTOR MATCH IDs ---
    async fetchShopifyProductsByIds(admin, productIds) {
        if (!admin || !productIds.length) return [];
        
        try {
            // Build a GraphQL query asking for these specific IDs
            // Shopify allows querying node ID lists using nodes query
            const response = await admin.graphql(
                `#graphql
                query getNodes($ids: [ID!]!) {
                    nodes(ids: $ids) {
                        ... on Product {
                            id
                            title
                            handle
                            description(truncateAt: 300)
                            productType
                            vendor
                            tags
                            variants(first: 1) {
                                edges {
                                    node {
                                        id
                                        price
                                    }
                                }
                            }
                            featuredImage {
                                url
                            }
                        }
                    }
                }`,
                { variables: { ids: productIds } }
            );

            const json = await response.json();
            const nodes = json.data?.nodes || [];

            return nodes.filter(Boolean).map(node => ({
                id: node.id,
                title: node.title,
                description: node.description,
                tags: node.tags,
                price: node.variants?.edges?.[0]?.node?.price ? `₹${node.variants.edges[0].node.price}` : "Price N/A",
                image: node.featuredImage?.url || "https://placehold.co/600x400?text=No+Image",
                url: `/products/${node.handle}`,
                variantId: node.variants?.edges?.[0]?.node?.id?.split('/').pop() || "",
                vendor: node.vendor || "Art Assistant"
            }));

        } catch (e) {
            console.error("fetchShopifyProductsByIds Error:", e);
            return [];
        }
    },

    // --- FALLBACK: GRAPHQL KEYWORD SEARCH ---
    async executeShopifyGraphQLSearch(admin, query) {
        if (!admin) return [];
        try {
            const cleanQuery = query.replace(/[^\w\s-]/g, "").trim();
            const graphQuery = cleanQuery 
                ? `(title:${cleanQuery}* OR tag:${cleanQuery}*)` 
                : "status:active";

            const response = await admin.graphql(
                `#graphql
                query ($q: String!) {
                    products(first: 10, query: $q) {
                        edges {
                            node {
                                title handle vendor
                                variants(first: 1) { edges { node { id price } } }
                                featuredImage { url }
                            }
                        }
                    }
                }`,
                { variables: { q: graphQuery } }
            );
            const json = await response.json();
            const items = json.data?.products?.edges.map(e => e.node) || [];

            return items.map(node => ({
                title: node.title,
                price: node.variants?.edges?.[0]?.node?.price ? `₹${node.variants.edges[0].node.price}` : "Price N/A",
                image: node.featuredImage?.url || "https://placehold.co/600x400?text=No+Image",
                url: `/products/${node.handle}`,
                variantId: node.variants?.edges?.[0]?.node?.id?.split('/').pop() || "",
                vendor: node.vendor || "Art Assistant"
            }));
        } catch (e) {
            console.error("executeShopifyGraphQLSearch Error:", e);
            return [];
        }
    },

    // --- RESILIENT SAFE FALLBACK MODE ---
    async getResilientResponse(admin, text) {
        try {
            if (text.match(/\b(hi|hello|hey|start|menu|help)\b/i)) {
                return {
                    reply: "Hi there! 👋 I'm operating in 'Resilient Mode' right now. I can still help you find paintings. What kind of style or room are you decorating?",
                    intent: "chat"
                };
            }
            const keywords = text.toLowerCase().split(" ").filter(w => w.length > 3).join(" ");
            const products = await this.executeShopifyGraphQLSearch(admin, keywords);
            return {
                reply: `I searched our catalog for "${keywords || 'artworks'}"! Here are some beautiful suggestions: 👇`,
                action: { type: "carousel", data: products },
                intent: "product_search"
            };
        } catch (e) {
            return {
                reply: "I'm having a little trouble connecting. Please feel free to browse our main navigation collections! 🖼️",
                intent: "error"
            };
        }
    }
};
