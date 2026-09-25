import React, { useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { apiPostForSession } from "@/lib/api";
import { useColors } from "@/hooks/useColors";

type CheckoutResult = { orderId: string; amount: number; currency: "INR"; keyId: string };
type RazorpayResponse = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };

/**
 * Native Standard Checkout launcher. The SDK callback is never treated as
 * payment proof: it is immediately sent to the bearer-authenticated server,
 * which fetches the provider payment/order and performs the atomic settlement.
 *
 * This component requires a development/production native build; Expo Go cannot
 * load react-native-razorpay.
 */
export function StudentPaymentCheckout({ feeRecordId, sessionId, onPaid }: {
  feeRecordId: number;
  sessionId: number;
  onPaid?: (receiptNumber: string) => void;
}) {
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const pay = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const order = await apiPostForSession<CheckoutResult>("/mobile/student/payments/create-order", sessionId, { feeRecordId });
      const RazorpayCheckout = (await import("react-native-razorpay")).default;
      const response: RazorpayResponse = await RazorpayCheckout.open({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: "BENIUS",
        description: "Student fee payment",
        theme: { color: colors.primary },
      });
      const settled = await apiPostForSession<{ ok: true; receiptNumber: string }>(
        "/mobile/student/payments/verify",
        sessionId,
        { feeRecordId, razorpayPaymentId: response.razorpay_payment_id, razorpayOrderId: response.razorpay_order_id },
      );
      onPaid?.(settled.receiptNumber);
    } catch (error: any) {
      const cancelled = error?.code === "PAYMENT_CANCELLED" || error?.code === 2;
      if (!cancelled) {
        Alert.alert("Payment not confirmed", error?.message ?? "Check the fee status and try again.");
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Pressable disabled={busy} onPress={pay} accessibilityRole="button">
      <View style={{ minHeight: 44, paddingHorizontal: 16, borderRadius: 10, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 }}>
        {busy ? <ActivityIndicator color={colors.primaryForeground} /> : null}
        <Text style={{ color: colors.primaryForeground, fontWeight: "700" }}>{busy ? "Checking payment…" : "Pay fee"}</Text>
      </View>
    </Pressable>
  );
}