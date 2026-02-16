import { GoogleGenerativeAI } from "@google/generative-ai";

export const AntigravityBrain = {

    async process(text, history = [], admin, apiKey) {
        if (!apiKey) {
            return {
                reply: "I'm currently offline (API Key missing). But I can still search for you!",
                intent: "search_fallback",
                confidence: 0
            };
        }

        const genAI = new GoogleGenerativeAI(apiKey);

        // --- 1. DEFINE TOOLS ---
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

        // --- 2. SYSTEM PROMPT ---
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            tools: tools,
            systemInstruction: `You are the "Art Assistant", a highly intelligent and aesthetic interior design consultant.
        
        YOUR GOAL: Help the user find the *perfect* painting for their space.

        BEHAVIOR GUIDELINES:
        1. **CONSULTANT MODE**:
           - If the user says "I want a painting" or "Show me art", DO NOT SEARCH YET.
           - ASK CLARIFYING QUESTIONS: "Which room is this for?" "Do you have a color theme?" "What is your budget?"
           - ONLY call 'search_products' when you have at least ONE specific criteria (Room, Color, Theme, or Vastu direction).
        
        2. **VASTU EXPERT**: 
           - If the user mentions a direction (North, South, East, West), IMMEDIATELY call 'get_vastu_advice'.
           - Explain the rule briefly, THEN search for art that matches that rule.

        3. **TONE**:
           - Use emojis (✨, 🎨, 🏡).
           - Be concise but warm.
           - If search results are empty, suggesting a broader term or a custom order.
        
        STORE INFO:
        - Premium Canvas Art, Spiritual, Abstract, Landscape.
        - Free Shipping in India.`
        });

        // --- 3. RUN CHAT ---
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

            // --- 4. HANDLE FUNCTION CALLS ---
            const call = response.functionCalls()?.[0];

            if (call) {
                if (call.name === "search_products") {
                    const { query, max_price, color } = call.args;
                    // Execute Search via Admin API
                    const products = await this.executeShopifySearch(admin, query, max_price, color);

                    // Return Structured Action for Frontend to Render Carousel
                    if (products.length > 0) {
                        return {
                            reply: `Here are some matches for **${query}**! ✨`,
                            action: {
                                type: "carousel",
                                data: products
                            },
                            intent: "product_search"
                        };
                    } else {
                        return { reply: `I couldn't find any exact matches for "${query}". Try a broader term?`, intent: "chat" };
                    }
                }

                if (call.name === "get_vastu_advice") {
                    const advice = await this.executeVastuQuery(admin, call.args.direction);
                    // Send advice back to model to formulate final answer? 
                    // Or just return it. 
                    // For simplicity/speed in V1: Return text directly + Search for that direction

                    const followUpSearch = await this.executeShopifySearch(admin, `Vastu ${call.args.direction} ${advice.keywords || ''}`);

                    return {
                        reply: `**Vastu Tip for ${call.args.direction}:** ${advice.recommendation}\n\nI've found some art that matches this energy! 👇`,
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
            return { reply: "I'm having a bit of trouble thinking clearly right now. 😵‍💫", intent: "error" };
        }
    },

    // --- HELPERS ---

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
