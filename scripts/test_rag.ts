async function run() {
  const query = "boligrafo mecanismo push";
  try {
    const response = await fetch("http://127.0.0.1:8001/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, top_k: 5 }),
    });
    if (response.ok) {
      const data = await response.json();
      console.log("RAG matches:");
      for (const p of data.products || []) {
        console.log(`- ID: ${p.product_id} | Name: ${p.name} | Description: ${p.description}`);
      }
    } else {
      console.error("RAG status:", response.status);
    }
  } catch (err: any) {
    console.error("Failed:", err.message);
  }
}
run();
