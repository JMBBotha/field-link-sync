import MySignatureCard from "@/components/settings/MySignatureCard";
import PushOptInCard from "@/components/settings/PushOptInCard";

/** /admin/my-signature — everyone edits their own email signature. */
const MySignaturePage = () => (
  <div className="p-3 md:p-6 max-w-4xl"><MySignatureCard /><PushOptInCard /></div>
);

export default MySignaturePage;
