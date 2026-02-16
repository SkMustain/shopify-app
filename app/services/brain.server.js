import { GoogleGenerativeAI } from "@google/generative-ai";

export const AntigravityBrain = {

    async process(text, history = [], admin, apiKey) {
        console.log("🧠 AntigravityBrain v4.8 (Stable Models & Retry) Processing...");
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

        // --- ATTEMPT 1: GEMINI 1.5 FLASH (Speed & Stability) ---
        // We use 1.5-flash as primary because it's the current production standard for speed/cost.
        try {
            return await this.runTraceWithRetry(genAI, "gemini-1.5-flash", systemPrompt, tools, history, text, admin);
        } catch (e) {
            console.warn("⚠️ Gemini 1.5 Flash Failed. Switching to Pro...", e.message);

            // --- ATTEMPT 2: GEMINI 1.5 PRO (Higher Intelligence) ---
            // If Flash fails (e.g. overloaded), try Pro. It's slower but smarter.
            try {
                return await this.runTraceWithRetry(genAI, "gemini-1.5-pro", systemPrompt, tools, history, text, admin);
            } catch (e2) {
                console.error("❌ ALL AI Models Failed. Entering RESILIENT MODE.", e2);

                try {
                    // --- RESILIENT MODE (Pseudo-Intelligence) ---
                    // 1. Check for Greetings
                    if (text.match(/\b(hi|hello|hey|start|menu)\b/i)) {
                        return {
                            reply: "Hi there! 👋 I'm operating in Low-Data Mode due to high traffic, but I can still help! What are you looking for?",
                            intent: "chat"
                        };
                    }

                    // 2. Extract Keywords (Simple Noun Extraction)
                    // We strip common stop words to find the "core" search term
                    const stopWords = ["i", "want", "looking", "for", "a", "an", "the", "some", "art", "painting", "can", "you", "show", "me", "pictures", "of"];
                    const keywords = text.toLowerCase().split(" ").filter(w => !stopWords.includes(w)).join(" ");

                    // 3. Execute Search with extracted keywords
                    // If keywords are empty, search for "Best Sellers"
                    const searchQuery = keywords.length > 2 ? keywords : "";

                    let products = await this.executeShopifySearch(admin, searchQuery);

                    if (products.length > 0) {
                        return {
                            reply: searchQuery
                                ? `I couldn't reach my creative brain, but I found these **${searchQuery}** artworks for you! 🎨`
                                : "I'm having trouble thinking, but here are our **Most Popular** artworks! 🔥",
                            action: { type: "carousel", data: products },
                            intent: "product_search"
                        };
                    } else {
                        // 4. Zero Results -> Show Best Sellers
                        const bestSellers = await this.executeShopifySearch(admin, "");
                        return {
                            reply: `I couldn't find anything for "${keywords}", but check out our customer favorites! 👇`,
                            action: { type: "carousel", data: bestSellers },
                            intent: "product_search"
                        };
                    }

                } catch (e3) {
                    console.error("❌ CRITICAL: Resilient Mode Failed:", e3);
                    return {
                        reply: "I'm having a technical hiccup. Please try clicking the 'Best Sellers' link in the menu above! 👆",
                        intent: "error"
                    };
                }
            }
        }
    },

    // --- SHARED EXECUTION LOGIC WITH RETRY ---
    async runTraceWithRetry(genAI, modelName, systemInstruction, tools, history, text, admin, retries = 2) {
        for (let i = 0; i <= retries; i++) {
            try {
                return await this.runTrace(genAI, modelName, systemInstruction, tools, history, text, admin);
            } catch (e) {
                console.warn(`Attempt ${i + 1} failed for ${modelName}:`, e.message);
                if (i === retries) throw e; // Throw only on last failure
                await new Promise(r => setTimeout(r, 1000 * (i + 1))); // Exponential backoff: 1s, 2s...
            }
        }
    },

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
        let finalQuery = query;
        if (color && !query.includes(color)) finalQuery = `${query} ${color}`;

        // Handle Empty Query -> "sort_key: BEST_SELLING"
        let graphqlQuery = "";
        let variables = {};

        if (!finalQuery || finalQuery.trim() === "") {
            // Fetch raw list (Best Sellers / Newest)
            graphqlQuery = `#graphql query { products(first: 10, sortKey: BEST_SELLING) { edges { node { id, title, handle, featuredImage { url }, priceRangeV2 { minVariantPrice { amount currencyCode } } } } } }`;
            variables = {};
        } else {
            // Search by keyword
            graphqlQuery = `#graphql query ($q: String!) { products(first: 10, query: $q) { edges { node { id, title, handle, featuredImage { url }, priceRangeV2 { minVariantPrice { amount currencyCode } } } } } }`;
            variables = { q: finalQuery };
        }

        try {
            const response = await admin.graphql(graphqlQuery, { variables });
            const json = await response.json();

            let items = json.data?.products?.edges.map(e => e.node) || [];

            if (maxPrice) items = items.filter(p => parseFloat(p.priceRangeV2.minVariantPrice.amount) <= maxPrice);

            return items.map(node => ({
                title: node.title,
                price: `${node.priceRangeV2.minVariantPrice.amount} ${node.priceRangeV2.minVariantPrice.currencyCode}`,
                image: node.featuredImage?.url,
                url: `/products/${node.handle}`,
                vendor: "Art Assistant"
            }));
        } catch (e) {
            console.error("Shopify Search GraphQL Error:", e);
            return []; // Return empty array instead of throwing
        }
    },
    async executeVastuQuery(admin, direction) {
        const rules = { "North": { recommendation: "Water/Wealth (Blue, Waterfall)", keywords: "Water Blue" }, "South": { recommendation: "Fire/Fame (Red, Horses)", keywords: "Red Fire" }, "East": { recommendation: "Air/Social (Green, Plants)", keywords: "Green Forest" }, "West": { recommendation: "Gains (White, Gold)", keywords: "White Gold" }, "North-East": { recommendation: "Sacred (Spiritual, Shiva)", keywords: "Shiva Spiritual" } };
        const normDir = Object.keys(rules).find(k => direction.toLowerCase().includes(k.toLowerCase())) || "North";
        return rules[normDir];
    }
};
