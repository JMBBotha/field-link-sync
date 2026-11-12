-- New quotes store the company standard terms (name + banking filled from that company's profile).
-- Not applied by the author of this change. Backfill of existing drafts is a separate one-off
-- in docs/db-releases/2026-11-12_draft_quote_terms_backfill.sql and must not be run from here.
-- Sent, accepted and invoiced quotes are left untouched. Invoices are not mentioned.

ALTER TABLE public.company_terms ADD COLUMN IF NOT EXISTS standard_text text;

UPDATE public.company_terms
SET standard_text = $std$Terms

Scope of Work:

1.1 Thank you for considering {company}. By accepting this quotation, you appoint us to supply and install the air conditioning equipment and services described above, in accordance with the terms and conditions below.

1.2 The services will be carried out by experienced technicians in a professional manner, adhering to industry standards and safety guidelines.

Pricing and Payment:

2.1 For supply-and-install jobs, a 70% deposit is payable on acceptance of this quotation and the balance is payable after installation. For units-only orders (supply without installation), full payment is payable on acceptance.

2.2 All products supplied carry our full warranty as set out in section 5 below.

2.3 Unless previously arranged with management, it will be assumed that you, the client, will be responsible for payment.

2.4 All goods remain the property of {company} until paid in full.

Electrical Work:

3.1 Please note that unless arranged otherwise, estimates exclude electrical connection to the DB Board.

3.2 A suitable electrical point needs to be provided within 1.5 m of the outdoor unit. For units with capacities of 24000Btu - 60000Btu. For units with capacities of 9000 - 18000, a suitable electrical/plug point needs to be provided.

Building Work:

4.1 Unless stated otherwise, our quotes exclude any building work, such as chase/core drilling and painting. These items will be quoted separately.

Warranty:

5.1 Two years warranty on all moving parts and a 3-year manufacturer's warranty on the compressor, subject to a service contract.

5.2 Our service contract extends the manufacturer's warranty on the compressor to 5 years. If the compressor fails, we will install the replacement compressor free of charge. Please note that this warranty is only valid on new units supplied and installed by {company}.

5.3 This warranty is in addition to, and does not replace or limit, any rights you have under the Consumer Protection Act 68 of 2008.

Errors and Omissions:

6.1 While every effort is made to ensure the accuracy of quotations, estimates, invoices and related documentation, including descriptions, specifications, and pricing, {company} shall not be held liable for any genuine clerical, typographical, printing, or administrative error or omission appearing in such documentation, provided that any such error is corrected as soon as it is identified and does not result in you being charged more than the fair value of the goods or services actually supplied.

6.2 Product specifications, capacities and performance figures referenced in our documentation are based on information published by the relevant manufacturer or supplier. While we take reasonable care in relying on this information, we cannot guarantee against errors made by third-party manufacturers or suppliers. Should a material error in a manufacturer's specification affect the suitability of a unit for your requirements, we will work with you in good faith to find a fair resolution.

6.3 Nothing in this clause limits or excludes any right you may have under the Consumer Protection Act 68 of 2008, and this clause does not apply to, and does not limit our liability for, gross negligence, fraud, or wilful misconduct.

Banking Details:

7.1 Account Name: {account_name}

7.2 Bank: {bank}

7.3 Account Type: {account_type}

7.4 Account Number: {account}

7.5 Branch Code: {branch}

Deposit Reference:

8.1 Please use the Proposal number found at the top of the page as a reference when making the deposit.

Confidentiality:

9.1 We respect the privacy and confidentiality of our clients. Any information shared during the course of our engagement will be treated as confidential and will not be disclosed to third parties, except as required by law or the Protection of Personal Information Act 4 of 2013 (POPIA).

Termination:

10.1 Either party may terminate the agreement by providing written notice to the other party, specifying the reasons for termination.

10.2 Termination may result in the settlement of outstanding payments for services already provided, as per the agreed terms.

Dispute Resolution:

11.1 In the event of any disputes or disagreements arising from our services, both parties agree to engage in good-faith negotiations to resolve the matter amicably before referring the matter to the National Consumer Commission, an accredited consumer ombud, or a court of competent jurisdiction.

Importance of Servicing AC Units

Health and Safety Concerns:

a. The health and safety of our customers are of utmost importance to us.

b. Regular servicing helps improve indoor air quality, reducing the risk of respiratory issues, allergies, and other health problems associated with poor air quality.

c. By addressing maintenance needs promptly, we ensure that your air conditioning system operates in a clean and safe manner, minimizing potential health risks.

d. Proper servicing also helps prevent the accumulation of mould, bacteria, and other harmful contaminants that can pose health hazards.

e. Additionally, routine maintenance plays a crucial role in mitigating the risk of Sick Building Syndrome, ensuring a healthier environment for both residential and commercial spaces.

Daily Running Costs with Rising Energy Costs in Mind:

a. We understand the concerns surrounding rising energy costs and the impact it has on your daily expenses.

b. Regular servicing and deep cleaning help ensure that your air conditioning unit operates at optimal efficiency, reducing its energy consumption and subsequently lowering your daily running costs.

c. Clean filters, coils, and vents allow the unit to cool your space more efficiently, requiring less energy to maintain a comfortable temperature.

d. By investing in servicing, you are taking a proactive step towards mitigating the impact of rising energy costs, helping you save money on your energy bills over time.

For commercial air conditioning units,

a. We highly recommend scheduling servicing every 6 months.

b. Commercial units endure heavy usage and operate in demanding environments, making regular maintenance crucial for their performance and longevity.

c. Our AC Super Service deep clean method includes a comprehensive cleaning of all components, such as filters, coils, and vents.

d. Adhering to the recommended servicing schedule allows your commercial unit to operate at its peak efficiency, leading to lower daily running costs.

e. Neglecting regular servicing may result in decreased efficiency, increased energy consumption, and higher energy costs, impacting your business's profitability.

f. Moreover, routine servicing helps us detect and address any potential issues promptly,

g. preventing costly breakdowns and major repairs that could disrupt your operations.

Regular servicing plays a vital role in minimizing the risk of premature system failure and the need for costly replacements

Please note that Service recommendations are provided in a manner to emphasize the benefits of regular servicing and the potential cost savings. However, it is important to be aware that neglecting servicing results in reduced performance, increased energy consumption, higher daily running costs, and potential system malfunctions.$std$
WHERE company_id = public.fl_master_company_id();

INSERT INTO public.company_terms (company_id, relocation_clause, standard_text)
SELECT public.fl_master_company_id(),
  $cl$This quote includes removing and relocating existing air conditioning units. The age, condition and internal state of these units, including compressors, electronics and other components, are unknown to us. Massair CT (Pty) Ltd will take the utmost care and follow correct procedures when removing, relocating, servicing and recommissioning them, but we cannot guarantee their condition, functionality or performance. Should any existing unit fail or not function correctly after relocation, whether immediately or at a later stage, this is not the responsibility of Massair CT (Pty) Ltd and the risk remains with the client. Any repairs or replacement parts required on existing units will be quoted separately.$cl$,
  $std$Terms

Scope of Work:

1.1 Thank you for considering {company}. By accepting this quotation, you appoint us to supply and install the air conditioning equipment and services described above, in accordance with the terms and conditions below.

1.2 The services will be carried out by experienced technicians in a professional manner, adhering to industry standards and safety guidelines.

Pricing and Payment:

2.1 For supply-and-install jobs, a 70% deposit is payable on acceptance of this quotation and the balance is payable after installation. For units-only orders (supply without installation), full payment is payable on acceptance.

2.2 All products supplied carry our full warranty as set out in section 5 below.

2.3 Unless previously arranged with management, it will be assumed that you, the client, will be responsible for payment.

2.4 All goods remain the property of {company} until paid in full.

Electrical Work:

3.1 Please note that unless arranged otherwise, estimates exclude electrical connection to the DB Board.

3.2 A suitable electrical point needs to be provided within 1.5 m of the outdoor unit. For units with capacities of 24000Btu - 60000Btu. For units with capacities of 9000 - 18000, a suitable electrical/plug point needs to be provided.

Building Work:

4.1 Unless stated otherwise, our quotes exclude any building work, such as chase/core drilling and painting. These items will be quoted separately.

Warranty:

5.1 Two years warranty on all moving parts and a 3-year manufacturer's warranty on the compressor, subject to a service contract.

5.2 Our service contract extends the manufacturer's warranty on the compressor to 5 years. If the compressor fails, we will install the replacement compressor free of charge. Please note that this warranty is only valid on new units supplied and installed by {company}.

5.3 This warranty is in addition to, and does not replace or limit, any rights you have under the Consumer Protection Act 68 of 2008.

Errors and Omissions:

6.1 While every effort is made to ensure the accuracy of quotations, estimates, invoices and related documentation, including descriptions, specifications, and pricing, {company} shall not be held liable for any genuine clerical, typographical, printing, or administrative error or omission appearing in such documentation, provided that any such error is corrected as soon as it is identified and does not result in you being charged more than the fair value of the goods or services actually supplied.

6.2 Product specifications, capacities and performance figures referenced in our documentation are based on information published by the relevant manufacturer or supplier. While we take reasonable care in relying on this information, we cannot guarantee against errors made by third-party manufacturers or suppliers. Should a material error in a manufacturer's specification affect the suitability of a unit for your requirements, we will work with you in good faith to find a fair resolution.

6.3 Nothing in this clause limits or excludes any right you may have under the Consumer Protection Act 68 of 2008, and this clause does not apply to, and does not limit our liability for, gross negligence, fraud, or wilful misconduct.

Banking Details:

7.1 Account Name: {account_name}

7.2 Bank: {bank}

7.3 Account Type: {account_type}

7.4 Account Number: {account}

7.5 Branch Code: {branch}

Deposit Reference:

8.1 Please use the Proposal number found at the top of the page as a reference when making the deposit.

Confidentiality:

9.1 We respect the privacy and confidentiality of our clients. Any information shared during the course of our engagement will be treated as confidential and will not be disclosed to third parties, except as required by law or the Protection of Personal Information Act 4 of 2013 (POPIA).

Termination:

10.1 Either party may terminate the agreement by providing written notice to the other party, specifying the reasons for termination.

10.2 Termination may result in the settlement of outstanding payments for services already provided, as per the agreed terms.

Dispute Resolution:

11.1 In the event of any disputes or disagreements arising from our services, both parties agree to engage in good-faith negotiations to resolve the matter amicably before referring the matter to the National Consumer Commission, an accredited consumer ombud, or a court of competent jurisdiction.

Importance of Servicing AC Units

Health and Safety Concerns:

a. The health and safety of our customers are of utmost importance to us.

b. Regular servicing helps improve indoor air quality, reducing the risk of respiratory issues, allergies, and other health problems associated with poor air quality.

c. By addressing maintenance needs promptly, we ensure that your air conditioning system operates in a clean and safe manner, minimizing potential health risks.

d. Proper servicing also helps prevent the accumulation of mould, bacteria, and other harmful contaminants that can pose health hazards.

e. Additionally, routine maintenance plays a crucial role in mitigating the risk of Sick Building Syndrome, ensuring a healthier environment for both residential and commercial spaces.

Daily Running Costs with Rising Energy Costs in Mind:

a. We understand the concerns surrounding rising energy costs and the impact it has on your daily expenses.

b. Regular servicing and deep cleaning help ensure that your air conditioning unit operates at optimal efficiency, reducing its energy consumption and subsequently lowering your daily running costs.

c. Clean filters, coils, and vents allow the unit to cool your space more efficiently, requiring less energy to maintain a comfortable temperature.

d. By investing in servicing, you are taking a proactive step towards mitigating the impact of rising energy costs, helping you save money on your energy bills over time.

For commercial air conditioning units,

a. We highly recommend scheduling servicing every 6 months.

b. Commercial units endure heavy usage and operate in demanding environments, making regular maintenance crucial for their performance and longevity.

c. Our AC Super Service deep clean method includes a comprehensive cleaning of all components, such as filters, coils, and vents.

d. Adhering to the recommended servicing schedule allows your commercial unit to operate at its peak efficiency, leading to lower daily running costs.

e. Neglecting regular servicing may result in decreased efficiency, increased energy consumption, and higher energy costs, impacting your business's profitability.

f. Moreover, routine servicing helps us detect and address any potential issues promptly,

g. preventing costly breakdowns and major repairs that could disrupt your operations.

Regular servicing plays a vital role in minimizing the risk of premature system failure and the need for costly replacements

Please note that Service recommendations are provided in a manner to emphasize the benefits of regular servicing and the potential cost savings. However, it is important to be aware that neglecting servicing results in reduced performance, increased energy consumption, higher daily running costs, and potential system malfunctions.$std$
WHERE public.fl_master_company_id() IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.company_terms ct WHERE ct.company_id = public.fl_master_company_id());

CREATE OR REPLACE FUNCTION public.fl_standard_terms_for_company(p_company uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tpl text;
  v_name text;
  v_account_name text;
  v_bank text;
  v_account text;
  v_branch text;
  v_type text;
BEGIN
  SELECT ct.standard_text INTO v_tpl
  FROM public.company_terms ct
  WHERE ct.company_id = public.fl_master_company_id();
  IF v_tpl IS NULL OR btrim(v_tpl) = '' THEN
    RETURN NULL;
  END IF;

  SELECT cp.legal_name, cp.account_name, cp.bank_name, cp.account_number, cp.branch_code, cp.account_type
    INTO v_name, v_account_name, v_bank, v_account, v_branch, v_type
  FROM public.company_profiles cp
  WHERE cp.company_id = p_company AND cp.archived_at IS NULL
  ORDER BY cp.is_default DESC, cp.created_at
  LIMIT 1;

  v_name := coalesce(nullif(btrim(v_name), ''), 'Our Company');
  v_account_name := coalesce(nullif(btrim(v_account_name), ''), v_name);
  -- Longer tokens first: replace('{account}') would otherwise eat {account_name} and {account_type}.
  v_tpl := replace(v_tpl, '{account_name}', v_account_name);
  v_tpl := replace(v_tpl, '{account_type}', coalesce(v_type, ''));
  v_tpl := replace(v_tpl, '{account}', coalesce(v_account, ''));
  v_tpl := replace(v_tpl, '{company}', v_name);
  v_tpl := replace(v_tpl, '{branch}', coalesce(v_branch, ''));
  v_tpl := replace(v_tpl, '{bank}', coalesce(v_bank, ''));
  RETURN v_tpl;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fl_standard_terms_for_company(uuid) FROM PUBLIC;

-- Admins may still set a per-quote wording. Everyone else gets the company standard on insert
-- and cannot change it afterwards (same rule as 28 Oct 2026).
CREATE OR REPLACE FUNCTION public.fl_quote_terms_guard() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::app_role) THEN
      IF NEW.terms_text IS NULL OR btrim(NEW.terms_text) = '' THEN
        NEW.terms_text := public.fl_standard_terms_for_company(NEW.company_id);
      END IF;
    ELSE
      NEW.terms_text := public.fl_standard_terms_for_company(NEW.company_id);
      NEW.relocation_clause := NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;
  IF NEW.terms_text IS DISTINCT FROM OLD.terms_text OR NEW.relocation_clause IS DISTINCT FROM OLD.relocation_clause THEN
    RAISE EXCEPTION 'Terms and conditions are company-wide and can only be changed by an admin' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;
