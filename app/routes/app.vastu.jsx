import { useState } from "react";
import { useLoaderData, useSubmit, useNavigation } from "react-router";
import {
    Page,
    Layout,
    Card,
    BlockStack,
    InlineStack,
    Text,
    Button,
    Thumbnail,
    EmptyState,
    Box,
    Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

// --- LOADER ---
export const loader = async ({ request }) => {
    const { admin } = await authenticate.admin(request);

    // Fetch products that have ANY Vastu tag
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

    const handleOpenPicker = async (dir) => {
        // Use window.shopify.resourcePicker
        const selected = await window.shopify.resourcePicker({
            type: 'product',
            multiple: true,
            action: 'select'
        });

        if (selected) {
            const ids = selected.map(r => r.id);
            submit(
                { actionType: "add", tag: `Vastu-${dir}`, productIds: JSON.stringify(ids) },
                { method: "post" }
            );
        }
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
