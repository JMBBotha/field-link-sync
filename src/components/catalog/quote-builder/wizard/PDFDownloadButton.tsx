import { useEffect, useState } from "react";
import { PDFDownloadLink } from "@react-pdf/renderer";
import { FileDown } from "lucide-react";
import QuotePDFDocument, { type QuotePDFData } from "@/components/QuotePDFDocument";
import { fetchTermsCompanyInfo } from "@/lib/documentPdf";
import type { TermsCompanyInfo } from "@/lib/defaultTerms";

interface Props {
  data: QuotePDFData;
}

export default function PDFDownloadButton({ data }: Props) {
  const [termsCompany, setTermsCompany] = useState<TermsCompanyInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTermsCompanyInfo()
      .then((info) => {
        if (!cancelled) setTermsCompany(info);
      })
      .catch(() => {
        if (!cancelled) setTermsCompany({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!termsCompany) {
    return (
      <div
        className="inline-flex items-center justify-center w-full gap-2 rounded-md px-4 py-2.5 text-sm font-medium text-white opacity-70"
        style={{ backgroundColor: "#16a34a" }}
      >
        Preparing PDF…
      </div>
    );
  }

  return (
    <PDFDownloadLink
      document={<QuotePDFDocument data={{ ...data, termsCompany }} />}
      fileName={`Quote-${data.quoteNumber}.pdf`}
      className="inline-flex items-center justify-center w-full gap-2 rounded-md px-4 py-2.5 text-sm font-medium text-white transition-colors"
      style={{ backgroundColor: "#16a34a" }}
    >
      {({ loading }) =>
        loading ? (
          <>Generating PDF…</>
        ) : (
          <>
            <FileDown className="h-4 w-4" />
            Download Professional Quote PDF
          </>
        )
      }
    </PDFDownloadLink>
  );
}
