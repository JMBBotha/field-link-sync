-- Rollback: company rename to 'Massair CT (Pty) Ltd' (2026-10-12)
begin;
update companies set name='Massair CT Pty Limited' where id='361bf031-9cdb-4d7f-9bde-9eb95fa4725e';
update company_profiles set legal_name='Massair CT Pty Limited', account_name='Massair CT Pty Limited', terms_text=replace(terms_text,'Massair CT (Pty) Ltd','Massair CT Pty Limited') where id='8ebd6434-3fca-5a8d-8476-270e994dcb46';
update company_settings set company_name='Massair CT Pty Limited', banking_details=jsonb_set(banking_details,'{account_name}','"Massair CT Pty Limited"') where id='a70c9005-45a7-444a-8b49-249a83b490b0';
update quotes set terms_text='BANKING DETAILS: 
6.1 Account Name: MASSAIR CT PTY LTD
6.2 Bank: FNB
6.3 Account Type: Cheque Account
6.4 Account Number: 63226563591
6.5 Branch Code: [250 655]

WARRANTY: One year on all moving parts, and a five year manufacturer''s warranty on the compressor subject to a service contract. Please Note: The service contract extends the manufacturer''s warranty on the compressor for 5 years should the compressor fail we will install the replacement compressor free of charge.

TERMS OF PAYMENT:Unless previously arranged with management it will be assumed that you the client will be responsible for payment. All goods remain the property of MASSAIR CT PTY LTD until paid in full.' where id='7783cb1c-018a-558e-b719-9ac8ff6feb0b';
update quotes set terms_text='Scope of Work:
1.1 Should u the client feel comfortable in appointing us for your HVAC project, We, Massair CT Pty Limited, agree to provide air conditioning services as outlined in the quotation/estimate above.
1.2 The services will be carried out by experienced technicians in a professional manner, adhering to industry standards and safety guidelines.

Pricing and Payment:
2.1 To provide the best possible price, the cost of the unit/s is to be paid in full as acceptance of our quotation. The remainder of the installation amount is payable upon completion of the project.
2.2 All products supplied carry our full warranty as set out in section 5 below.
2.3 Unless previously arranged with management, it will be assumed that you, the client, will be responsible for payment.
2.4 All goods remain the property of Massair CT Pty Limited until paid in full.

Electrical Work:
3.1 Please note that unless arranged otherwise, estimates exclude electrical connection to the DB Board.
3.2 A suitable electrical point needs to be provided within 1.5 m of the outdoor unit. For units with capacities of 24000Btu - 60000Btu. For units with capacities of 9000 - 18000, a suitable electrical/plug point needs to be provided.

Building Work:
4.1 Unless stated otherwise, our quotes exclude any building work, such as chase/core drilling and painting. These items will be quoted separately.

Warranty:
5.1 Two years warranty on all moving parts and a 3-year manufacturer''s warranty on the compressor, subject to a service contract.
5.2 Our service contract extends the manufacturer''s warranty on the compressor to 5 years. If the compressor fails, we will install the replacement compressor free of charge. Please note that this warranty is only valid on new units supplied and installed by Massair CT Pty Limited.

Banking Details:
6.1 Account Name: Massair CT Pty Limited
6.2 Bank: FNB
6.3 Account Type: Cheque Account
6.4 Account Number: 63226563591
6.5 Branch Code: [250 655]

Deposit Reference:
7.1 Please use the Proposal number found at the top of the page as a reference when making the deposit.

Confidentiality:
8.1 We respect the privacy and confidentiality of our clients. Any information shared during the course of our engagement will be treated as confidential and will not be disclosed to third parties, except as required by law.

Termination:
9.1 Either party may terminate the agreement by providing written notice to the other party, specifying the reasons for termination.
9.2 Termination may result in the settlement of outstanding payments for services already provided, as per the agreed terms.

Dispute Resolution:
10.1 In the event of any disputes or disagreements arising from our services, both parties agree to engage in good-faith negotiations to resolve the matter amicably.

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
e. Neglecting regular servicing may result in decreased efficiency, increased energy consumption, and higher energy costs, impacting your business''s profitability.
f. Moreover, routine servicing helps us detect and address any potential issues promptly,
g. preventing costly breakdowns and major repairs that could disrupt your operations. Regular servicing plays a vital role in minimizing the risk of premature system failure and the need for costly replacements
Please note that Service recommendations are provided in a manner to emphasize the benefits of regular servicing and the potential cost savings. However, it is important to be aware that neglecting servicing results in reduced performance, increased energy consumption, higher daily running costs, and potential system malfunctions.' where id='b47a0e11-2d7c-4c3e-9a51-0b1e2a7f1012';
update quotes set terms_text='BANKING DETAILS: 
6.1 Account Name: MASSAIR CT PTY LTD
6.2 Bank: FNB
6.3 Account Type: Cheque Account
6.4 Account Number: 63226563591
6.5 Branch Code: [250 655]

WARRANTY: One year on all moving parts, and a five year manufacturer''s warranty on the compressor subject to a service contract. Please Note: The service contract extends the manufacturer''s warranty on the compressor for 5 years should the compressor fail we will install the replacement compressor free of charge.

TERMS OF PAYMENT:Unless previously arranged with management it will be assumed that you the client will be responsible for payment. All goods remain the property of MASSAIR CT PTY LTD until paid in full.' where id='69bc2e3f-5d6a-53f3-a074-c41343e5b0d6';
update quotes set terms_text='BANKING DETAILS: 
6.1 Account Name: MASSAIR CT PTY LTD
6.2 Bank: FNB
6.3 Account Type: Cheque Account
6.4 Account Number: 63226563591
6.5 Branch Code: [250 655]

WARRANTY: One year on all moving parts, and a five year manufacturer''s warranty on the compressor subject to a service contract. Please Note: The service contract extends the manufacturer''s warranty on the compressor for 5 years should the compressor fail we will install the replacement compressor free of charge.

TERMS OF PAYMENT:Unless previously arranged with management it will be assumed that you the client will be responsible for payment. All goods remain the property of MASSAIR CT PTY LTD until paid in full.' where id='02412ab0-782b-5a93-934a-53215cf15572';
update quotes set terms_text='Scope of Work:
1.1 Should u the client feel comfortable in appointing us for your HVAC project, We, Massair CT Pty Limited, agree to provide air conditioning services as outlined in the quotation/estimate above.
1.2 The services will be carried out by experienced technicians in a professional manner, adhering to industry standards and safety guidelines.

Pricing and Payment:
2.1 To provide the best possible price, the cost of the unit/s is to be paid in full as acceptance of our quotation. The remainder of the installation amount is payable upon completion of the project.
2.2 All products supplied carry our full warranty as set out in section 5 below.
2.3 Unless previously arranged with management, it will be assumed that you, the client, will be responsible for payment.
2.4 All goods remain the property of Massair CT Pty Limited until paid in full.

Electrical Work:
3.1 Please note that unless arranged otherwise, estimates exclude electrical connection to the DB Board.
3.2 A suitable electrical point needs to be provided within 1.5 m of the outdoor unit. For units with capacities of 24000Btu - 60000Btu. For units with capacities of 9000 - 18000, a suitable electrical/plug point needs to be provided.

Building Work:
4.1 Unless stated otherwise, our quotes exclude any building work, such as chase/core drilling and painting. These items will be quoted separately.

Warranty:
5.1 Two years warranty on all moving parts and a 3-year manufacturer''s warranty on the compressor, subject to a service contract.
5.2 Our service contract extends the manufacturer''s warranty on the compressor to 5 years. If the compressor fails, we will install the replacement compressor free of charge. Please note that this warranty is only valid on new units supplied and installed by Massair CT Pty Limited.

Banking Details:
6.1 Account Name: Massair CT Pty Limited
6.2 Bank: FNB
6.3 Account Type: Cheque Account
6.4 Account Number: 63226563591
6.5 Branch Code: [250 655]

Deposit Reference:
7.1 Please use the Proposal number found at the top of the page as a reference when making the deposit.

Confidentiality:
8.1 We respect the privacy and confidentiality of our clients. Any information shared during the course of our engagement will be treated as confidential and will not be disclosed to third parties, except as required by law.

Termination:
9.1 Either party may terminate the agreement by providing written notice to the other party, specifying the reasons for termination.
9.2 Termination may result in the settlement of outstanding payments for services already provided, as per the agreed terms.

Dispute Resolution:
10.1 In the event of any disputes or disagreements arising from our services, both parties agree to engage in good-faith negotiations to resolve the matter amicably.

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
e. Neglecting regular servicing may result in decreased efficiency, increased energy consumption, and higher energy costs, impacting your business''s profitability.
f. Moreover, routine servicing helps us detect and address any potential issues promptly,
g. preventing costly breakdowns and major repairs that could disrupt your operations. Regular servicing plays a vital role in minimizing the risk of premature system failure and the need for costly replacements
Please note that Service recommendations are provided in a manner to emphasize the benefits of regular servicing and the potential cost savings. However, it is important to be aware that neglecting servicing results in reduced performance, increased energy consumption, higher daily running costs, and potential system malfunctions.' where id='1bc98aae-ef8f-5143-8d1c-4d4cbe365382';
update invoices set profile_snapshot='{"id": "8ebd6434-3fca-5a8d-8476-270e994dcb46", "email": "info@0800becool.co.za", "phone": "(021) 802 2889", "website": null, "whatsapp": null, "bank_name": "FNB", "company_id": "361bf031-9cdb-4d7f-9bde-9eb95fa4725e", "is_default": true, "legal_name": "MASSAIR CT PTY LTD", "number_pad": 7, "terms_text": "BANKING DETAILS: \n6.1 Account Name: MASSAIR CT PTY LTD\n6.2 Bank: FNB\n6.3 Account Type: Cheque Account\n6.4 Account Number: 63226563591\n6.5 Branch Code: [250 655]\n\nWARRANTY: One year on all moving parts, and a five year manufacturer''s warranty on the compressor subject to a service contract. Please Note: The service contract extends the manufacturer''s warranty on the compressor for 5 years should the compressor fail we will install the replacement compressor free of charge.\n\nTERMS OF PAYMENT:Unless previously arranged with management it will be assumed that you the client will be responsible for payment. All goods remain the property of MASSAIR CT PTY LTD until paid in full.", "vat_number": "4630313080", "archived_at": null, "branch_code": "250655", "account_name": "MASSAIR CT PTY LTD", "account_type": "Cheque", "trading_name": "0800-BE-COOL", "address_lines": ["9A Cabernet Rd", "Blackheath", "Cape Town", "7580"], "account_number": "63226563591", "invoice_prefix": "", "use_shared_sequence": false}'::jsonb where id='7cc1f2f5-ec58-518b-a11b-c1752ece055f';
update invoices set profile_snapshot='{"id": "8ebd6434-3fca-5a8d-8476-270e994dcb46", "email": "info@0800becool.co.za", "phone": "(021) 802 2889", "website": null, "whatsapp": null, "bank_name": "FNB", "company_id": "361bf031-9cdb-4d7f-9bde-9eb95fa4725e", "is_default": true, "legal_name": "MASSAIR CT PTY LTD", "number_pad": 7, "terms_text": "BANKING DETAILS: \n6.1 Account Name: MASSAIR CT PTY LTD\n6.2 Bank: FNB\n6.3 Account Type: Cheque Account\n6.4 Account Number: 63226563591\n6.5 Branch Code: [250 655]\n\nWARRANTY: One year on all moving parts, and a five year manufacturer''s warranty on the compressor subject to a service contract. Please Note: The service contract extends the manufacturer''s warranty on the compressor for 5 years should the compressor fail we will install the replacement compressor free of charge.\n\nTERMS OF PAYMENT:Unless previously arranged with management it will be assumed that you the client will be responsible for payment. All goods remain the property of MASSAIR CT PTY LTD until paid in full.", "vat_number": "4630313080", "archived_at": null, "branch_code": "250655", "account_name": "MASSAIR CT PTY LTD", "account_type": "Cheque", "trading_name": "0800-BE-COOL", "address_lines": ["9A Cabernet Rd", "Blackheath", "Cape Town", "7580"], "account_number": "63226563591", "invoice_prefix": "", "use_shared_sequence": false}'::jsonb where id='842cd699-48b0-598e-a0ea-def41a486d54';
update invoices set profile_snapshot='{"id": "8ebd6434-3fca-5a8d-8476-270e994dcb46", "email": "info@0800becool.co.za", "phone": "(021) 802 2889", "website": null, "whatsapp": null, "bank_name": "FNB", "company_id": "361bf031-9cdb-4d7f-9bde-9eb95fa4725e", "is_default": true, "legal_name": "Massair CT Pty Limited", "number_pad": 7, "terms_text": "BANKING DETAILS: \n6.1 Account Name: Massair CT Pty Limited\n6.2 Bank: FNB\n6.3 Account Type: Cheque Account\n6.4 Account Number: 63226563591\n6.5 Branch Code: [250 655]\n\nWARRANTY: One year on all moving parts, and a five year manufacturer''s warranty on the compressor subject to a service contract. Please Note: The service contract extends the manufacturer''s warranty on the compressor for 5 years should the compressor fail we will install the replacement compressor free of charge.\n\nTERMS OF PAYMENT:Unless previously arranged with management it will be assumed that you the client will be responsible for payment. All goods remain the property of Massair CT Pty Limited until paid in full.", "vat_number": "4630313080", "archived_at": null, "branch_code": "250 655", "account_name": "Massair CT Pty Limited", "account_type": "Cheque", "trading_name": "0800-BE-COOL", "address_lines": ["9A Cabernet Road", "Blackheath", "Cape Town", "7580"], "account_number": "63226563591", "invoice_prefix": "", "use_shared_sequence": false}'::jsonb where id='497f9c1a-ba67-47aa-a5c6-9aedf411d290';
commit;
