import { PDFDownloadLink } from "@react-pdf/renderer";
import { FileDown } from "lucide-react";
import QuotePDFDocument, { type QuotePDFData } from "@/components/QuotePDFDocument";

interface Props {
  data: QuotePDFData;
}

export default function PDFDownloadButton({ data }: Props) {
  return (
    <PDFDownloadLink
      document={<QuotePDFDocument data={data} />}
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
