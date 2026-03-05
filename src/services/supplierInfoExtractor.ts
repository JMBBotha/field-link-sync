import * as pdfjsLib from "pdfjs-dist";

// Ensure worker is loaded
if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

export interface ExtractedDepartment {
  department: string;
  emails: string[];
  phones: string[];
  contactName?: string;
}

export interface ExtractedLocation {
  city: string;
  address?: string;
  phones: string[];
  emails: string[];
  whatsapp?: string;
}

export interface ExtractedSupplierInfo {
  companyName: string | null;
  vatNumber: string | null;
  registrationNumber: string | null;
  website: string | null;
  mainPhone: string | null;
  mainEmail: string | null;
  mainWhatsapp: string | null;
  headOfficeAddress: string | null;
  departments: ExtractedDepartment[];
  locations: ExtractedLocation[];
  allEmails: string[];
  allPhones: string[];
}

const SA_CITIES = [
  "Cape Town", "Johannesburg", "Pretoria", "Durban", "Bloemfontein",
  "Port Elizabeth", "Gqeberha", "East London", "Polokwane", "Nelspruit",
  "Mbombela", "Kimberley", "George", "Pietermaritzburg", "Sandton",
  "Midrand", "Centurion", "Randburg", "Roodepoort", "Fourways",
  "Stellenbosch", "Richards Bay", "Rustenburg", "Witbank", "Emalahleni",
  "Pinetown", "Umhlanga",
];

const DEPARTMENTS = ["Sales", "Accounts", "Finance", "Technical", "Support", "Service", "Dispatch", "Returns", "Management", "Warranty", "Spares", "Parts"];

export async function extractSupplierInfoFromPDF(
  source: File | Blob | string
): Promise<ExtractedSupplierInfo> {
  let pdfData: ArrayBuffer;

  if (typeof source === "string") {
    const resp = await fetch(source);
    pdfData = await resp.arrayBuffer();
  } else {
    pdfData = await source.arrayBuffer();
  }

  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;

  // Extract text from first 4 pages (contact info usually there)
  let fullText = "";
  const pagesToScan = Math.min(4, pdf.numPages);
  for (let i = 1; i <= pagesToScan; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    fullText += textContent.items.map((item: any) => item.str).join(" ") + "\n";
  }

  // Also scan last page (often has contact info)
  if (pdf.numPages > 4) {
    const lastPage = await pdf.getPage(pdf.numPages);
    const lastContent = await lastPage.getTextContent();
    fullText += lastContent.items.map((item: any) => item.str).join(" ") + "\n";
  }

  return parseSupplierText(fullText);
}

function parseSupplierText(text: string): ExtractedSupplierInfo {
  const allEmails = extractAllMatches(text, /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g);
  const allPhones = extractAllMatches(
    text,
    /(?:\+27|0)\s*\(?\d{2}\)?\s*[\d\s\-]{6,12}/g
  ).map((p) => p.replace(/\s+/g, " ").trim());

  return {
    companyName: extractPattern(text, /(?:Company|Supplier|Manufacturer)[:\s]+([A-Z][A-Za-z\s&()]+?)(?:\s{2,}|\n|$)/i),
    vatNumber: extractPattern(text, /VAT\s*(?:No\.?|Number|#)?[:\s]*(\d{10,15})/i),
    registrationNumber: extractPattern(text, /(?:Reg(?:istration)?|CK|Co\.?\s*Reg)[:\s.]*(?:No\.?|Number|#)?[:\s]*([\d/\-]+)/i),
    website: extractPattern(text, /((?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9\-]+\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?)/i),
    mainPhone: allPhones[0] || null,
    mainEmail: allEmails.find((e) => /^info@|^enquir|^contact@|^admin@/i.test(e)) || allEmails[0] || null,
    mainWhatsapp: extractPattern(text, /(?:WhatsApp|WA)[:\s]*((?:\+27|0)\s*\(?\d{2}\)?\s*[\d\s\-]{6,12})/i),
    headOfficeAddress: extractPattern(
      text,
      /(?:Head\s*Office|Physical\s*Address|Address)[:\s]*([^\n]{10,120})/i
    ),
    departments: extractDepartments(text, allEmails),
    locations: extractLocations(text),
    allEmails: [...new Set(allEmails)],
    allPhones: [...new Set(allPhones)],
  };
}

function extractDepartments(text: string, allEmails: string[]): ExtractedDepartment[] {
  const found: ExtractedDepartment[] = [];

  for (const dept of DEPARTMENTS) {
    const deptLower = dept.toLowerCase();

    // Match emails that start with department name
    const deptEmails = allEmails.filter((e) => {
      const local = e.split("@")[0].toLowerCase();
      return local.includes(deptLower) || local.includes(deptLower.slice(0, 4));
    });

    // Match phone patterns near department keyword
    const deptRegex = new RegExp(
      `${dept}[^\\n]{0,80}`,
      "gi"
    );
    const contextMatches = text.match(deptRegex) || [];
    const deptPhones: string[] = [];
    for (const ctx of contextMatches) {
      const phones = extractAllMatches(ctx, /(?:\+27|0)\s*\(?\d{2}\)?\s*[\d\s\-]{6,12}/g);
      deptPhones.push(...phones);
    }

    // Extract contact name near department
    let contactName: string | undefined;
    for (const ctx of contextMatches) {
      const nameMatch = ctx.match(/:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/);
      if (nameMatch) {
        contactName = nameMatch[1];
        break;
      }
    }

    if (deptEmails.length > 0 || deptPhones.length > 0) {
      found.push({
        department: dept,
        emails: [...new Set(deptEmails)],
        phones: [...new Set(deptPhones.map((p) => p.replace(/\s+/g, " ").trim()))],
        contactName,
      });
    }
  }

  return found;
}

function extractLocations(text: string): ExtractedLocation[] {
  const found: ExtractedLocation[] = [];

  for (const city of SA_CITIES) {
    const cityRegex = new RegExp(
      `${city.replace(/\s/g, "\\s*")}[^\\n]{0,200}`,
      "gi"
    );
    const matches = text.match(cityRegex);
    if (!matches) continue;

    const context = matches.join(" ");
    const emails = extractAllMatches(context, /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g);
    const phones = extractAllMatches(context, /(?:\+27|0)\s*\(?\d{2}\)?\s*[\d\s\-]{6,12}/g)
      .map((p) => p.replace(/\s+/g, " ").trim());
    const whatsapp = extractPattern(context, /(?:WhatsApp|WA|Cell|Mobile)[:\s]*((?:\+27|0)\s*\(?\d{2}\)?\s*[\d\s\-]{6,12})/i);

    // Only add if we found contact info for this city
    if (emails.length > 0 || phones.length > 0) {
      found.push({
        city,
        phones: [...new Set(phones)],
        emails: [...new Set(emails)],
        whatsapp: whatsapp || undefined,
      });
    }
  }

  return found;
}

function extractPattern(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match ? (match[1] || match[0]).trim() : null;
}

function extractAllMatches(text: string, pattern: RegExp): string[] {
  const matches = text.match(pattern);
  return matches ? [...new Set(matches.map((m) => m.trim()))] : [];
}
