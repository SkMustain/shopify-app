import { useLoaderData, Form } from "react-router"; // FIXED: Use react-router v7
import { authenticate } from "../shopify.server";
import {
    Page,
    Layout,
    Card,
    Button,
    Text,
    BlockStack,
    List,
    Badge
} from "@shopify/polaris";

export const loader = async ({ request }) => {
    const { admin } = await authenticate.admin(request);
    const url = new URL(request.url);
    const direction = url.searchParams.get("direction") || "North";

    // 1. Tag Search
    const tagQuery = `tag:Vastu-${direction}`;
    const response = await admin.graphql(
        `#graphql
      query ($query: String!) {
        products(first: 50, query: $query) {
          edges {
            node {
              id
              title
              handle
              tags
              status
              totalInventory
            }
          }
        }
      }`,
        { variables: { query: tagQuery } }
    );

    const responseJson = await response.json();
    const products = responseJson.data?.products?.edges.map(e => e.node) || [];

    return { direction, products, tagQuery };
};

export default function Debug() {
    const { direction, products, tagQuery } = useLoaderData();

    return (
        <Page title="Vastu Debugger">
            <Layout>
                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <Text as="h2" variant="headingMd">Debug Search: {direction}</Text>
                            <Text as="p">Query Used: <code>{tagQuery}</code></Text>

                            <Form method="get">
                                <BlockStack gap="200" inlineAlign="start">
                                    <Text>Change Direction:</Text>
                                    <div style={{ display: "flex", gap: "10px" }}>
                                        <Button submit name="direction" value="North">North</Button>
                                        <Button submit name="direction" value="South">South</Button>
                                        <Button submit name="direction" value="East">East</Button>
                                        <Button submit name="direction" value="West">West</Button>
                                    </div>
                                </BlockStack>
                            </Form>

                            <Text variant="headingSm">Results Found: {products.length}</Text>

                            {products.length === 0 ? (
                                <Badge tone="critical">No Products Found</Badge>
                            ) : (
                                <List type="bullet">
                                    {products.map(p => (
                                        <List.Item key={p.id}>
                                            <Text fontWeight="bold">{p.title}</Text> <Badge tone={p.status === 'ACTIVE' ? 'success' : 'attention'}>{p.status}</Badge> | Tags: {p.tags.join(", ")}
                                        </List.Item>
                                    ))}
                                </List>
                            )}
                        </BlockStack>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
