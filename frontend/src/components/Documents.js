// The list of a property's papers on IPFS, each checked against the blockchain.
import { API_URL } from "@/lib/api";
import { Badge, Card, Table } from "./ui";

const kindLabel = {
  "listing-papers": "Listing papers", "sale-deed": "Sale deed", "title-report": "Title report",
  "tax-receipt": "Tax receipt", "rent-agreement": "Rent agreement", valuation: "Valuation", photo: "Photo", other: "Other",
};

export default function Documents({ documents, extra }) {
  return (
    <Card title="Property papers (IPFS)" actions={extra}>
      <Table
        rows={documents}
        empty="No papers uploaded yet."
        columns={[
          { label: "Paper", render: (d) => kindLabel[d.kind] || d.kind },
          {
            label: "File",
            render: (d) => (
              <a href={API_URL + d.url} target="_blank" rel="noreferrer" className="text-brand underline">
                {d.fileName}
              </a>
            ),
          },
          {
            label: "Check",
            render: (d) =>
              d.verified ? <Badge tone="green">Matches blockchain</Badge> : <Badge tone="red">Does not match</Badge>,
          },
        ]}
      />
      <p className="mt-3 text-xs text-muted">
        Each file&apos;s fingerprint (CID) is saved in the property&apos;s smart contract, so anyone can check the papers were never changed.
      </p>
    </Card>
  );
}
