import { GoogleGenerativeAI } from "@google/generative-ai";

export const AntigravityBrain = {

    async process(text, history = [], admin, apiKey) {
        console.log("🧠 AntigravityBrain v4.2 (Force Deploy) Processing...");
        if (!apiKey) {
            return {
                reply: "I'm currently offline (API Key missing). But I can still search for you!",
                intent: "search_fallback",
                confidence: 0
            };
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const storeContext = await this.fetchStoreContext(admin);

        // --- DEFINE TOOLS & PROMPT ---
        const tools = [{
            functionDeclarations: [
                {
                    name: "search_products",
                    description: "Search for art products in the catalog based on user query, budget, key color, or theme.",
                    parameters: {
                        type: "OBJECT",
                        properties: {
                            query: { type: "STRING", description: "The main search keywords (e.g. 'abstract landscape', 'shiva', 'modern art')" },
                            max_price: { type: "NUMBER", description: "Maximum budget in INR (e.g. 5000)" },
                            color: { type: "STRING", description: "Dominant color filter if needed" }
                        },
                        required: ["query"]
                    }
                },
                {
                    name: "get_vastu_advice",
                    description: "Get Vastu Shastra rules for a specific direction (North, South, East, West).",
                    parameters: {
                        type: "OBJECT",
                        properties: {
                            direction: { type: "STRING", description: "The compass direction (e.g. 'North', 'South-East')" }
                        },
                        required: ["direction"]
                    }
                }
            ]
        }];

        const systemPrompt = `You are the "Art Assistant", a highly intelligent, empathetic, and aesthetic interior design consultant.
        YOUR GOAL: deeply understand what the customer wants and guide them to the perfect art piece.
        
        STORE KNOWLEDGE (Ground Truth):
        - Available Collections: ${storeContext.collections}
        - Product Types: ${storeContext.types}
        - We specialize in: Premium Canvas, Vastu Art, and Modern Decor.
        - Free Shipping in India.

        BEHAVIOR GUIDELINES:
        1. **ACTIVE LISTENING**: Acknowledge user needs.
        2. **CONSULTANT MODE**: Ask clarifying questions if vague.
        3. **VASTU EXPERT**: Immediate advice for directions.
        4. **TONE**: Warm, Professional, Artistic. Use emojis (✨, 🎨).
        `;

        // --- ATTEMPT 1: GEMINI 2.0 FLASH (High Quality) ---
        try {
            return await this.runTrace(genAI, "gemini-2.0-flash", systemPrompt, tools, history, text, admin);
        } catch (e) {
            console.warn("⚠️ Gemini 2.0 Failed (Quota/Error). Switching to Fallback...", e.message);

            // --- ATTEMPT 2: GEMINI 1.5 FLASH (Reliable Fallback) ---
            try {
                return await this.runTrace(genAI, "gemini-1.5-flash", systemPrompt, tools, history, text, admin);
            } catch (e2) {
                console.error("❌ ALL Brain Models Failed:", e2);
                return { reply: "I'm feeling a bit overwhelmed right now. 😵‍💫 Could you try searching for keywords directly?", intent: "error" };
            }
        }
    },

    // --- SHARED EXECUTION LOGIC ---
    async runTrace(genAI, modelName, systemInstruction, tools, history, text, admin) {
        console.log(`🤖 Attempting execution with model: ${modelName}`);
        const model = genAI.getGenerativeModel({ model: modelName, tools, systemInstruction });

        const chat = model.startChat({
            history: history.map(h => ({
                role: h.role === 'bot' ? 'model' : 'user',
                parts: [{ text: h.message }]
            }))
        });

        const result = await chat.sendMessage(text);
        const response = result.response;
        const call = response.functionCalls()?.[0];

        if (call) {
            if (call.name === "search_products") {
                const { query, max_price, color } = call.args;
                const products = await this.executeShopifySearch(admin, query, max_price, color);
                if (products.length > 0) {
                    return {
                        reply: `Here are some beautiful matches for **${query}**! ✨`,
                        action: { type: "carousel", data: products },
                        intent: "product_search"
                    };
                } else {
                    return { reply: `I couldn't find matches for "${query}". Try "Abstract" or "Nature"?`, intent: "chat" };
                }
            }
            if (call.name === "get_vastu_advice") {
                const advice = await this.executeVastuQuery(admin, call.args.direction);
                const followUpSearch = await this.executeShopifySearch(admin, `Vastu ${call.args.direction} ${advice.keywords || ''}`);
                return {
                    reply: `**Vastu Insight for ${call.args.direction}:** ${advice.recommendation}\n\nSelected auspicious pieces: 👇`,
                    action: { type: "carousel", data: followUpSearch },
                    intent: "vastu_consult"
                };
            }
        }

        return { reply: response.text(), intent: "chat" };
    },

    // --- HELPERS (Unchanged) ---
    async fetchStoreContext(admin) {
        try {
            const response = await admin.graphql(`{ collections(first: 10) { edges { node { title } } } productTypes(first: 10) { edges { node } } }`);
            const json = await response.json();
            const collections = json.data?.collections?.edges.map(e => e.node.title).join(", ") || "Art, Canvas";
            const types = json.data?.productTypes?.edges.map(e => e.node).join(", ") || "Painting";
            return { collections, types };
        } catch (e) { return { collections: "General Art", types: "Canvas" }; }
    },
    async executeShopifySearch(admin, query, maxPrice, color) {
        let finalQuery = color && !query.includes(color) ? `${query} ${color}` : query;
        const response = await admin.graphql(`#graphql query ($q: String!) { products(first: 10, query: $q) { edges { node { id, title, handle, featuredImage { url }, priceRangeV2 { minVariantPrice { amount currencyCode } } } } } }`, { variables: { q: finalQuery } });
        const json = await response.json();
        let items = json.data?.products?.edges.map(e => e.node) || [];
        if (maxPrice) items = items.filter(p => parseFloat(p.priceRangeV2.minVariantPrice.amount) <= maxPrice);
        return items.map(node => ({ title: node.title, price: `${node.priceRangeV2.minVariantPrice.amount} ${node.priceRangeV2.minVariantPrice.currencyCode}`, image: node.featuredImage?.url, url: `/products/${node.handle}`, vendor: "Art Assistant" }));
    },
    async executeVastuQuery(admin, direction) {
        const rules = { "North": { recommendation: "Water/Wealth (Blue, Waterfall)", keywords: "Water Blue" }, "South": { recommendation: "Fire/Fame (Red, Horses)", keywords: "Red Fire" }, "East": { recommendation: "Air/Social (Green, Plants)", keywords: "Green Forest" }, "West": { recommendation: "Gains (White, Gold)", keywords: "White Gold" }, "North-East": { recommendation: "Sacred (Spiritual, Shiva)", keywords: "Shiva Spiritual" } };
        const normDir = Object.keys(rules).find(k => direction.toLowerCase().includes(k.toLowerCase())) || "North";
        return rules[normDir];
    }
};
