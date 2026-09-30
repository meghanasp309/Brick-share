"use client";
// Your rupee wallet: add money (test Razorpay), withdraw, and see every movement.
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { getSocket } from "@/lib/live";
import { pay } from "@/lib/payments";
import { useLoad } from "@/lib/useLoad";
import { date, rupees } from "@/lib/format";
import KycNotice from "@/components/KycNotice";
import RequireLogin from "@/components/RequireLogin";
import { Alert, Button, Card, Field, Input, Loading, Page, Stat, Table } from "@/components/ui";

export default function WalletPage() {
  return (
    <RequireLogin roles={["investor", "owner"]}>
      <Wallet />
    </RequireLogin>
  );
}

const typeLabel = { deposit: "Added money", withdrawal: "Withdrew to bank", buy: "Bought shares", sell: "Sold shares", rent: "Rent received", rent_paid: "Monthly rent paid" };

function details(e) {
  if (!e.property) return "–";
  if (e.shares) return `${e.property.name} · ${e.shares} shares`;
  if (e.period) return `${e.property.name} · ${e.period}`;
  return e.property.name;
}

function Wallet() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api("/wallet"), []);

  // Reload when money moves (a trade settled, rent arrived).
  useEffect(() => {
    const socket = getSocket();
    const onChange = () => reload();
    socket.on("wallet", onChange);
    socket.on("rent", onChange);
    return () => {
      socket.off("wallet", onChange);
      socket.off("rent", onChange);
    };
  }, [reload]);

  if (loading) return <Loading />;
  if (error) return <Page title="Wallet"><Alert>{error}</Alert></Page>;
  const { wallet, history } = data;

  return (
    <Page title="Wallet" subtitle={user.role === "owner" ? "Your rupees for paying and receiving rent. Test money only." : "Your rupees for trading. Rent lands here too. Test money only."}>
      <KycNotice user={user} />
      <Card className="mb-6">
        <div className="grid grid-cols-3 gap-6">
          <Stat label="Balance" value={rupees(wallet.balance)} />
          <Stat label="Held for open orders" value={rupees(wallet.held)} />
          <Stat label="You can use" value={rupees(wallet.available)} />
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6">
          <AddMoney owner={user.role === "owner"} disabled={user.kycStatus !== "approved"} onDone={reload} />
          <Withdraw available={wallet.available} onDone={reload} />
        </div>
        <Card title="History" className="lg:col-span-2">
          <Table
            rows={history}
            empty="No money movements yet."
            columns={[
              { label: "What", render: (e) => typeLabel[e.type] || e.type },
              { label: "Details", render: details },
              {
                label: "Amount",
                align: "right",
                render: (e) => <span className={e.amount >= 0 ? "text-emerald-600" : "text-red-600"}>{e.amount >= 0 ? "+" : ""}{rupees(e.amount)}</span>,
              },
              { label: "Date", render: (e) => date(e.createdAt) },
            ]}
          />
        </Card>
      </div>
    </Page>
  );
}

function AddMoney({ owner, disabled, onDone }) {
  const [amount, setAmount] = useState(10000);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const { deposit, checkout } = await api("/wallet/deposits", { body: { amount: Number(amount) } });
      await pay(checkout, `/wallet/deposits/${deposit.id}`);
      setMsg({ tone: "success", text: `${rupees(Number(amount))} added.` });
      onDone();
    } catch (err) {
      setMsg({ tone: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Add money">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Amount (₹)">
          <Input type="number" min={1} step={0.01} required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          {[1000, 10000, 50000].map((n) => (
            <button key={n} type="button" onClick={() => setAmount(n)} className="rounded-md border border-line px-2 py-1 text-xs hover:bg-soft">
              {rupees(n)}
            </button>
          ))}
        </div>
        <Button type="submit" busy={busy} disabled={disabled} className="w-full">Pay with Razorpay (test)</Button>
        {owner && <p className="text-xs text-muted">Your monthly rent is paid from this wallet.</p>}
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      </form>
    </Card>
  );
}

function Withdraw({ available, onDone }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/wallet/withdraw", { body: { amount: Number(amount) } });
      setMsg({ tone: "success", text: `${rupees(Number(amount))} sent to your bank (simulated).` });
      setAmount("");
      onDone();
    } catch (err) {
      setMsg({ tone: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Withdraw to bank">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Amount (₹)" hint={`You can withdraw up to ${rupees(available)}`}>
          <Input type="number" min={1} step={0.01} max={available} required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Button type="submit" variant="secondary" busy={busy} disabled={available <= 0} className="w-full">Withdraw</Button>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      </form>
    </Card>
  );
}
