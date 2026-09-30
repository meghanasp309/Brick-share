import Link from "next/link";
import { Alert } from "./ui";

/** Tells investors and owners to finish KYC before they can buy, trade or list. */
export default function KycNotice({ user }) {
  if (!user || user.kycStatus === "approved" || !["investor", "owner"].includes(user.role)) return null;
  const text = {
    none: "Verify your ID (KYC) before you can buy, trade or list.",
    pending: "Your ID is waiting for an admin to check it. You can buy and trade once it's approved.",
    rejected: "Your ID was rejected. Please send it again.",
  }[user.kycStatus];
  return (
    <div className="mb-6">
      <Alert tone={user.kycStatus === "pending" ? "info" : "error"}>
        {text}{" "}
        {user.kycStatus !== "pending" && (
          <Link href="/kyc" className="font-medium underline">
            Go to KYC
          </Link>
        )}
      </Alert>
    </div>
  );
}
