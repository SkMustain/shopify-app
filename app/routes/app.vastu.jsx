import { useState, useCallback } from "react";
import { useLoaderData, useSubmit, useActionData, useNavigation } from "react-router";
import {
    Page,
    Layout,
    Card,
    BlockStack,
    InlineStack,
    Text,
    Button,
    Thumbnail,
    Banner,
    Listbox,
    EmptyState,
    Box,
    Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { ResourcePicker } from "@shopify/app-bridge-react";

// --- LOADER ---
export const loader = async ({ request }) => {
    const { admin } = await authenticate.admin(request);

    // Fetch products that have ANY Vastu tag
    // We search for "tag:Vastu-North OR tag:Vastu-South ..." but flexible
    const response = await admin.graphql(
        `#graphql
      query {
        products(first: 100, query: "tag:Vastu-North OR tag:Vastu-South OR tag:Vastu-East OR tag:Vastu-West") {
          edges {
            node {
              id
              title
              handle
              featuredImage { url }
              tags
            }
          }
        }
      }`
    );

    const json = await response.json();
    const products = json.data.products.edges.map((e) => e.node);

    return { products };
};

// --- ACTION (ADD/REMOVE TAGS) ---
export const action = async ({ request }) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();

    const actionType = formData.get("actionType"); // "add" or "remove"
    const tag = formData.get("tag"); // e.g. "Vastu-North"
    const productIds = JSON.parse(formData.get("productIds")); // ["gid://shopify/Product/123", ...]

    if (!productIds.length) return { status: "success" };

    console.log(`Action: ${actionType} tag ${tag} for products`, productIds);

    // We must update tags for EACH product.
    // Ideally use bulk mutation, but loop is fine for small scale UI.

    // 1. Fetch current tags for these products first (to append/remove safely)
    // OPTIMIZATION: We simply use 'tagsAdd' or 'tagsRemove' mutation usually.

    const mutation = actionType === "add"
        ? `#graphql
        mutation addTags($id: ID!, $tags: [String!]!) {
          tagsAdd(id: $id, tags: $tags) {
            node { id }
            userErrors { field message }
          }
        }`
        : `#graphql
        mutation removeTags($id: ID!, $tags: [String!]!) {
          tagsRemove(id: $id, tags: $tags) {
            node { id }
            userErrors { field message }
          }
        }`;

    for (const id of productIds) {
        await admin.graphql(mutation, {
            variables: {
                id: id,
                tags: [tag]
            }
        });
    }

    return { status: "success" };
};


// --- COMPONENT ---
export default function VastuDashboard() {
    const { products } = useLoaderData();
    const submit = useSubmit();
    const nav = useNavigation();
    const isLoading = nav.state === "submitting";

    const [pickerOpen, setPickerOpen] = useState(false);
    const [currentDirection, setCurrentDirection] = useState("North"); // North, South, East, West

    const directions = [
        { name: "North", color: "info", desc: "Water / Wealth / Career" },
        { name: "South", color: "critical", desc: "Fire / Fame / Success" },
        { name: "East", color: "success", desc: "Nature / Health / Family" },
        { name: "West", color: "warning", desc: "Mountains / Creativity / Children" },
    ];

    // Helper to filter products by direction
    const getProductsFor = (dir) => {
        return products.filter(p => p.tags.includes(`Vastu-${dir}`));
    };

    const handleOpenPicker = (dir) => {
        setCurrentDirection(dir);
        setPickerOpen(true);
    };

    const handleSelection = (resources) => {
        setPickerOpen(false);
        const ids = resources.selection.map(r => r.id);

        // Submit Action
        submit(
            { actionType: "add", tag: `Vastu-${currentDirection}`, productIds: JSON.stringify(ids) },
            { method: "post" }
        );
    };

    const handleRemove = (productId, dir) => {
        submit(
            { actionType: "remove", tag: `Vastu-${dir}`, productIds: JSON.stringify([productId]) },
            { method: "post" }
        );
    };

    return (
        <Page title="Vastu Consultant Dashboard" subtitle="Manage artwork recommendations for each direction">
            <Layout>

                {/* RESOURCE PICKER */}
                <ResourcePicker
                    resourceType="Product"
                    open={pickerOpen}
                    onSelection={handleSelection}
                    onCancel={() => setPickerOpen(false)}
                    showVariants={false}
                />

                <Layout.Section>
                    <BlockStack gap="500">
                        {directions.map((dir) => {
                            const dirProducts = getProductsFor(dir.name);

                            return (
                                <Card key={dir.name}>
                                    <BlockStack gap="400">
                                        <InlineStack align="space-between" blockAlign="center">
                                            <BlockStack gap="100">
                                                <InlineStack gap="200" blockAlign="center">
                                                    <Text variant="headingLf" as="h3">{dir.name}</Text>
                                                    <Badge tone={dir.color}>{dir.desc}</Badge>
                                                </InlineStack>
                                                <Text tone="subdued">Tag: <code>Vastu-{dir.name}</code></Text>
                                            </BlockStack>
                                            <Button onClick={() => handleOpenPicker(dir.name)} variant="primary">Add Products</Button>
                                        </InlineStack>

                                        <Box paddingBlockStart="200">
                                            {dirProducts.length === 0 ? (
                                                <EmptyState heading="No products selected" image="">
                                                    <Text tone="subdued">Select artwork that matches the {dir.name} Vastu energy.</Text>
                                                </EmptyState>
                                            ) : (
                                                <BlockStack gap="300">
                                                    {dirProducts.map(p => (
                                                        <InlineStack key={p.id} align="space-between" blockAlign="center">
                                                            <InlineStack gap="400" blockAlign="center">
                                                                <Thumbnail source={p.featuredImage?.url || ""} alt={p.title} size="small" />
                                                                <Text variant="bodyMd" fontWeight="bold">{p.title}</Text>
                                                            </InlineStack>
                                                            <Button
                                                                tone="critical"
                                                                variant="plain"
                                                                onClick={() => handleRemove(p.id, dir.name)}
                                                                disabled={isLoading}
                                                            >
                                                                Remove
                                                            </Button>
                                                        </InlineStack>
                                                    ))}
                                                </BlockStack>
                                            )}
                                        </Box>
                                    </BlockStack>
                                </Card>
                            );
                        })}
                    </BlockStack>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
