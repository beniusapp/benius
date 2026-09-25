declare module 'react-native-razorpay' {
  export type RazorpayOptions = {
    key: string;
    amount: number;
    currency: 'INR';
    order_id: string;
    name: string;
    description?: string;
    theme?: { color?: string };
  };

  export type RazorpayCheckoutResponse = {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  };

  const RazorpayCheckout: {
    open(options: RazorpayOptions): Promise<RazorpayCheckoutResponse>;
  };

  export default RazorpayCheckout;
}