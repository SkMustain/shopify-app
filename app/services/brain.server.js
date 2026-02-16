import { GoogleGenerativeAI } from "@google/generative-ai";

export const AntigravityBrain = {

    async process(text, history = [], admin, apiKey) {
        console.log("🧠 AntigravityBrain v4.0 (Data-Aware) Processing...");
        if (!apiKey) {
            return {
                reply: "I'm currently offline (API Key missing). But I can still search for you!",
                intent: "search_fallback",
                confidence: 0
            };
        }

        const genAI = new GoogleGenerativeAI(apiKey);

        // --- 1. FETCH STORE CONTEXT (Real-time) ---
        // Fetch collections and types to give the AI "Ground Truth" about what is actually sold.
        const storeContext = await this.fetchStoreContext(admin);

        // --- 2. DEFINE TOOLS ---
        const tools = [
            {
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
            }
        ];

        // --- 3. SYSTEM PROMPT (High Quality & Empathetic) ---
        const systemPrompt = `You are the "Art Assistant", a highly intelligent, empathetic, and aesthetic interior design consultant.
        
        YOUR GOAL: deeply understand what the customer wants and guide them to the perfect art piece.
        
        STORE KNOWLEDGE (Ground Truth):
        - Available Collections: ${storeContext.collections}
        - Product Types: ${storeContext.types}
        - We specialize in: Premium Canvas, Vastu Art, and Modern Decor.
        - Free Shipping in India.

        BEHAVIOR GUIDELINES:
        1. **ACTIVE LISTENING (Critical)**:
           - Before making a recommendation, acknowledge what the user said.
           - Example: "I understand you're looking for something widely peaceful for your bedroom. That sounds lovely."
           - If the user is vague ("I need art"), ASK CLARIFYING QUESTIONS politely ("What kind of vibe are you aiming for? Modern, Traditional, or maybe something Spiritual?").

        2. **CONSULTANT MODE**:
           - Don't just be a search engine. Be a *guide*.
           - Use the 'search_products' tool ONLY when you have specific preferences (Room, Color, Theme, or Budget).
           - If the user shares a personal story ("It's for my new house"), celebrate with them! ("Congratulations on your new home! 🏡 Let's make it beautiful.")

        3. **VASTU EXPERT**: 
           - If the user mentions a direction (North, South, East, West), IMMEDIATELY call 'get_vastu_advice'.
           - Explain *why* a certain art is good for that direction.

        4. **TONE**:
           - Warm, Professional, Artistic.
           - Use emojis sparingly but effectively (✨, 🎨, 🌿).
        `;

        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash",
            tools: tools,
            systemInstruction: systemPrompt
        });

        // --- 4. RUN CHAT ---
        try {
            // Map simple history format if needed (User/Model)
            // For now, we start fresh or use minimal context provided in 'history' arg
            const chat = model.startChat({
                history: history.map(h => ({
                    role: h.role === 'bot' ? 'model' : 'user',
                    parts: [{ text: h.message }]
                }))
            });

            const result = await chat.sendMessage(text);
            const response = result.response;

            // --- 5. HANDLE FUNCTION CALLS ---
            const call = response.functionCalls()?.[0];

            if (call) {
                if (call.name === "search_products") {
                    const { query, max_price, color } = call.args;
                    // Execute Search via Admin API
                    const products = await this.executeShopifySearch(admin, query, max_price, color);

                    // Return Structured Action for Frontend to Render Carousel
                    if (products.length > 0) {
                        return {
                            reply: `Here are some beautiful matches for **${query}** that I think you'll love! ✨`,
                            action: {
                                type: "carousel",
                                data: products
                            },
                            intent: "product_search"
                        };
                    } else {
                        return { reply: `I looked for "${query}", but I couldn't find an exact match in our current collection. Could we try a broader theme like "Abstract" or "Nature"?`, intent: "chat" };
                    }
                }

                if (call.name === "get_vastu_advice") {
                    const advice = await this.executeVastuQuery(admin, call.args.direction);
                    const followUpSearch = await this.executeShopifySearch(admin, `Vastu ${call.args.direction} ${advice.keywords || ''}`);

                    return {
                        reply: `**Vastu Insight for ${call.args.direction}:** ${advice.recommendation}\n\nBased on this, I've selected these auspicious pieces for you: 👇`,
                        action: {
                            type: "carousel",
                            data: followUpSearch
                        },
                        intent: "vastu_consult"
                    };
                }
            }

            // Plain Text Response
            return {
                reply: response.text(),
                intent: "chat"
            };

        } catch (e) {
            console.error("Brain Error:", e);
            return { reply: `DEBUG ERROR: ${e.message}\n${e.stack}`, intent: "error" };
        }
    },

    // --- HELPERS ---

    async fetchStoreContext(admin) {
        try {
            const response = await admin.graphql(
                `#graphql
                query {
                    collections(first: 10) { edges { node { title } } }
                    productTypes(first: 10) { edges { node } }
                }`
            );
            const json = await response.json();
            const collections = json.data?.collections?.edges.map(e => e.node.title).join(", ") || "Art, Canvas, Decor";
            const types = json.data?.productTypes?.edges.map(e => e.node).join(", ") || "Painting, Print";
            return { collections, types };
        } catch (e) {
            console.error("Context Fetch Error:", e);
            return { collections: "General Art", types: "Canvas" };
        }
    },

    async executeShopifySearch(admin, query, maxPrice, color) {
        // Construct Query
        let finalQuery = query;
        if (color && !query.includes(color)) finalQuery += ` ${color}`;

        // Shopify Search
        const response = await admin.graphql(
            `#graphql
        query ($q: String!) {
            products(first: 10, query: $q) {
                edges { node {
                    id, title, handle, description, 
                    featuredImage { url }, 
                    priceRangeV2 { minVariantPrice { amount currencyCode } }
                }}
            }
        }`,
            { variables: { q: finalQuery } }
        );

        const json = await response.json();
        let items = json.data?.products?.edges.map(e => e.node) || [];

        // Filter Price in Memory
        if (maxPrice) {
            items = items.filter(p => parseFloat(p.priceRangeV2.minVariantPrice.amount) <= maxPrice);
        }

        return items.map(node => ({
            title: node.title,
            price: `${node.priceRangeV2.minVariantPrice.amount} ${node.priceRangeV2.minVariantPrice.currencyCode}`,
            image: node.featuredImage?.url,
            url: `/products/${node.handle}`,
            vendor: "Art Assistant"
        }));
    },

    async executeVastuQuery(admin, direction) {
        // Mock Vastu Database for now (or query Prisma if available)
        const rules = {
            "North": { recommendation: "North represents Water and Wealth. Use Blue colors, Flowing Water, or Kuber Yantras.", keywords: "Water Blue Waterfall" },
            "South": { recommendation: "South is Fire and Fame. Use Red, Phoenix, or Running Horses for recognition.", keywords: "Red Fire Horses" },
            "East": { recommendation: "East is Air and Social Connections. Use Greenery, Rising Sun, or Plants.", keywords: "Green Sun Forest" },
            "West": { recommendation: "West is Gains. Use White, Gold, or Camel art.", keywords: "White Gold Metal" },
            "North-East": { recommendation: "The most sacred corner. Use Spiritual art, Meditating Shiva, or Om.", keywords: "Shiva Spiritual Om" }
        };

        const normDir = Object.keys(rules).find(k => direction.toLowerCase().includes(k.toLowerCase())) || "North";
        return rules[normDir];
    }
};
