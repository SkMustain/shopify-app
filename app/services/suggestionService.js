export const getSuggestions = async (prompt) => {
    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Mock response based on simple keywords or random
    const suggestions = [
        {
            title: "Abstract Canvas Print",
            description: "A vibrant abstract piece perfect for modern living rooms.",
            price: "150.00"
        },
        {
            title: "Minimalist Sculpture",
            description: "Elegant white stone sculpture for a clean aesthetic.",
            price: "300.00"
        },
        {
            title: "Vintage Oil Painting",
            description: "Classic scenery with rich textures and colors.",
            price: "450.00"
        }
    ];

    return suggestions;
};
