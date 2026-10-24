// Sample formulary for dry runs and as the CSV template. The clinic replaces
// this with its real medicine list and counts before clinic day.
export const SAMPLE_FORMULARY = `name,strength,form,unit,batch,expiry,starting_count,low_threshold,alternatives
Paracetamol,500 mg,tablet,tab,PC2401,2028-06-30,2000,200,Ibuprofen
Ibuprofen,400 mg,tablet,tab,IB2402,2027-12-31,600,60,Paracetamol
Amoxicillin,250 mg,capsule,cap,AM2403,2027-09-30,500,60,Amoxicillin 500 mg; Co-trimoxazole
Amoxicillin,500 mg,capsule,cap,AM2404,2027-09-30,400,50,Amoxicillin; Co-trimoxazole
Amoxicillin suspension,125 mg/5 ml,syrup 100 ml,bottle,AS2405,2027-03-31,40,8,Co-trimoxazole suspension
Co-trimoxazole,480 mg,tablet,tab,CT2406,2027-11-30,400,50,Amoxicillin
Co-trimoxazole suspension,240 mg/5 ml,syrup 100 ml,bottle,CS2407,2027-05-31,30,6,Amoxicillin suspension
Artemether-lumefantrine,20/120 mg,tablet pack (24),pack,AL2408,2027-08-31,60,10,
Amlodipine,5 mg,tablet,tab,AD2409,2028-01-31,300,60,Nifedipine retard
Nifedipine retard,20 mg,tablet,tab,NF2410,2027-10-31,120,30,Amlodipine
Hydrochlorothiazide,25 mg,tablet,tab,HC2411,2028-02-28,300,60,
Metformin,500 mg,tablet,tab,MF2412,2028-03-31,600,120,
Glibenclamide,5 mg,tablet,tab,GB2413,2027-12-31,200,40,
Albendazole,400 mg,tablet,tab,AB2414,2028-05-31,300,40,Mebendazole
Mebendazole,100 mg,tablet,tab,MB2415,2027-07-31,200,30,Albendazole
ORS sachets,20.5 g/L,sachet,sachet,OR2416,2027-12-31,200,40,
Zinc,20 mg,dispersible tablet,tab,ZN2417,2027-10-31,300,50,
Ferrous sulfate + folic acid,200 mg/0.4 mg,tablet,tab,FF2418,2028-01-31,600,100,
Vitamin B complex,,tablet,tab,VB2419,2027-12-31,500,60,
Omeprazole,20 mg,capsule,cap,OM2420,2027-11-30,200,40,
Chlorphenamine,4 mg,tablet,tab,CP2421,2028-04-30,300,40,
Metronidazole,400 mg,tablet,tab,MZ2422,2027-09-30,300,40,
Ciprofloxacin,500 mg,tablet,tab,CF2423,2027-08-31,150,30,
Tetracycline eye ointment,1%,ointment 5 g,tube,TE2424,2027-06-30,60,10,
Hydrocortisone cream,1%,cream 15 g,tube,HY2425,2027-09-30,40,8,
Clotrimazole cream,1%,cream 20 g,tube,CL2426,2027-10-31,50,10,
Benzyl benzoate lotion,25%,lotion 100 ml,bottle,BB2427,2027-07-31,30,6,
Paracetamol syrup,120 mg/5 ml,syrup 60 ml,bottle,PS2428,2027-04-30,60,10,Ibuprofen syrup
Ibuprofen syrup,100 mg/5 ml,syrup 100 ml,bottle,IS2429,2027-05-31,30,6,Paracetamol syrup
`;
