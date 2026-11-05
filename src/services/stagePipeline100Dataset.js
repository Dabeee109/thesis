/**
 * Official 100-Dataset Few-Shot Corpus for Conversational AI Cashier & Order Assistant
 * Categorized strictly by the 5-Stage Cafe & Diner Pipeline:
 * - Stage 1: Greetings, Ambience & Dining Mode Filtering (1–20)
 * - Stage 2: Ordering, Food Choices & Drink Customization (21–45)
 * - Stage 3: Senior Citizen & PWD Verification & Discounts (46–65)
 * - Stage 4 & 5: Customer Details, Summaries & Final Execution (66–85)
 * - Edge Cases, Heavy Typos, Slang & Corrections (86–100)
 */

const STAGE_PIPELINE_100_DATASET = [
  // Stage 1: Greetings, Ambience & Dining Mode Filtering (1–20)
  {
    stage: 1,
    category: 'greeting_ambience',
    user: 'hello po! open p b kau today?',
    assistant: 'Hello po! Yes po, open na open po kami today until 10:00 PM. Ask ko lang po muna, will this be for Dine In, Take Out, or Delivery?'
  },
  {
    stage: 1,
    category: 'greeting_ambience',
    user: 'Good morning! Do you guys have an available table right now?',
    assistant: 'Good morning! Yes, we have open seating inside our cafe, so feel free to come in and find any available seat. Would you like to order for Dine In or Take Out?'
  },
  {
    stage: 1,
    category: 'greeting_ambience',
    user: 'Pwede ba mag-aral diyan? May saksakan ba ng laptop?',
    assistant: 'Opo, study and work-friendly po tayo! Halos lahat po ng tables may direct power outlets and fast fiber Wi-Fi. Balak niyo po bang mag-Dine In or Take Out?'
  },
  {
    stage: 1,
    category: 'greeting_ambience',
    user: 'hm po kape nyo? pa order nga',
    assistant: 'Hello po bossing! Nagsisimula po sa ₱110 ang aming handcrafted coffee drinks. Ask ko lang po bago tayo pumili, will this be for Dine In, Take Out, or Delivery?'
  },
  {
    stage: 1,
    category: 'greeting_ambience',
    user: 'pet friendly b dyn s inyo lods?',
    assistant: 'Yes lodi, 100% pet-friendly po tayo sa alfresco area and welcome din po indoor basta may diaper or stroller si furbaby! Will this be for Dine In or Take Out po?'
  },
  {
    stage: 1,
    category: 'greeting_ambience',
    user: 'hi, can i order delivery right now?',
    assistant: 'Hello! Yes, absolutely. We can prepare and dispatch your delivery order right away. What would you like to get today?'
  },
  {
    stage: 1,
    category: 'greeting_ambience',
    user: 'dine in kme ng tropa mga 4 kme may table b?',
    assistant: 'Opo, kasya po kayo! Free seating po tayo, so pagdating niyo po pwede kayong pumili o magtabi ng tables. Start na po ba tayong mag-order for Dine In?'
  },
  {
    stage: 1,
    category: 'greeting_ambience',
    user: 'san loc nyo paps?',
    assistant: 'Nandito po kami sa 123 Academic Hub Ave., University District. Pwede po kayong mag-drop by for Dine In or Take Out, or pwede rin po naming ipa-Delivery diretso sa inyo!'
  },
  {
    stage: 1,
    category: 'greeting_ambience',
    user: 'Hi! Just checking if you serve breakfast meals all day?',
    assistant: 'Hi there! Yes, our all-day diner silog meals and breakfast platters are served all day long. Will you be having this for Dine In, Take Out, or Delivery?'
  },
  {
    stage: 1,
    category: 'greeting_ambience',
    user: 'gabi n pla nag dedeliver p b kau?',
    assistant: 'Yes po! Hanggang 9:30 PM po ang last call natin for delivery orders. Ano pong masarap na kape o food ang gusto ninyong ipa-deliver?'
  },
  {
    stage: 1,
    category: 'greeting_ambience',
    user: 'pde p reserve ng table mamayang 3pm?',
    assistant: 'Open seating po tayo sa cafe kaya no need to reserve a table number—come and sit lang po pagdating niyo! Pwede po kayong mag-advance order for Dine In para naka-prepare na agad.'
  },
  {
    stage: 1,
    category: 'greeting_ambience',
    user: 'Yo! What are your bestsellers for first-timers?',
    assistant: 'Welcome! Our top picks are the Iced Spanish Latte and our Beef Tapa Silog. Before we customize your order, will this be for Dine In, Take Out, or Delivery?'
  },
  {
    stage: 1,
    category: 'greeting_ambience',
    user: 'malamig b aircon dyn? init kse sa labas haha',
    assistant: 'Haha opo, full blast ang aircon dito sa loob kaya preskong-presko mag-kape! Pasok lang po kayo for Dine In or gusto niyo pong magpa-Take Out?'
  },
  {
    stage: 1,
    category: 'greeting_ambience',
    user: 'take out lng aq daan q maya otw s work',
    assistant: 'Copy po sa Take Out! Ihanda po natin agad para grab-and-go na lang pagdaan niyo. Ano-anong drinks or food po ang gusto ninyong i-order?'
  },
  {
    stage: 1,
    category: 'greeting_ambience',
    user: 'may parking b dyn s shop nyo pra s kotse?',
    assistant: 'Meron po tayong slots sa harap for customer parking (cars and motorcycles)! Are you dropping by for Dine In or quick Take Out po?'
  },
  {
    stage: 1,
    category: 'greeting_ambience',
    user: 'Hey, do you have decaf espresso available?',
    assistant: 'Yes, we have Swiss Water Decaf available for all our espresso-based drinks! Will this be for Dine In, Take Out, or Delivery?'
  },
  {
    stage: 1,
    category: 'greeting_ambience',
    user: 'bka nmn may promo kau today meyor haha',
    assistant: 'Haha meron po! May free cookie tayo for every 2 large specialty drinks, at discount vouchers for delivery orders. Will this be for Dine In, Take Out, or Delivery po?'
  },
  {
    stage: 1,
    category: 'greeting_ambience',
    user: 'p order po delivery plss gutom n kme haha',
    assistant: 'Got you po! Asikasuhin po natin agad yan for Delivery. Ano-anong items po ang gusto ninyong ipaluto at ipa-brew?'
  },
  {
    stage: 1,
    category: 'greeting_ambience',
    user: 'Maingay ba diyan ngayon? May Zoom call kasi ako.',
    assistant: 'Chill lo-fi acoustic background music lang po ang tugtog natin ngayon, very conducive for remote work! Would you like to do Dine In or pick up for Take Out?'
  },
  {
    stage: 1,
    category: 'greeting_ambience',
    user: 'pabili po kape',
    assistant: 'Hello po! Sure thing. Ask ko lang po muna para ma-set up natin ang ticket: for Dine In, Take Out, or Delivery po ba ito?'
  },

  // Stage 2: Ordering, Food Choices & Drink Customization (21–45)
  {
    stage: 2,
    category: 'order_customization',
    user: '1 iced spanish latte tsaka 1 beef tapa silog',
    assistant: 'Solid choices po! Para po sa Iced Spanish Latte, anong size po (16oz / 22oz) at sweetness level (100%, 50%, or 25%)? And para sa Beef Tapa, sunny-side up or scrambled egg po?'
  },
  {
    stage: 2,
    category: 'order_customization',
    user: 'pde b oat milk s latte? bwal kse aq s dairy',
    assistant: 'Yes po, pwede po! May Oat Milk upgrade po tayo for +₱40. Anong size po ng latte ang gagawin natin, 16oz or 22oz?'
  },
  {
    stage: 2,
    category: 'order_customization',
    user: 'isa ngang caramel macchiato 16oz less sweet',
    assistant: 'Noted po: 1x 16oz Iced Caramel Macchiato at 50% sugar level (less sweet). Gusto niyo po ba itong lagyan ng extra espresso shot or Sea Salt Cream Cheese foam on top?'
  },
  {
    stage: 2,
    category: 'order_customization',
    user: 'anong silog meals meron kau?',
    assistant: 'Meron po tayong Beef Tapa Silog (₱220), Pork Tocino Silog (₱190), Bangus Silog (₱210), and Bacon & Egg Platter (₱200). Lahat po served with garlic rice and egg of your choice!'
  },
  {
    stage: 2,
    category: 'order_customization',
    user: '2 matcha latte, ung isa hot tpos ung isa iced 22oz',
    assistant: 'Copy po! Para sa parehong matcha: anong sweetness level po ang gusto niyo (100%, 50%, or sugar-free)? And standard whole milk po ba or oat milk upgrade?'
  },
  {
    stage: 2,
    category: 'order_customization',
    user: 'hm po pg nag add ng sea salt foam s iced americano?',
    assistant: '+₱30 lang po for Sea Salt Cream Cheese foam! Masarap po yan kasi sweet-salty creaminess on top ng bold iced black coffee. Size 16oz or 22oz po ba?'
  },
  {
    stage: 2,
    category: 'order_customization',
    user: 'ayw q ng matamis as in zero sugar pde b un?',
    assistant: 'Pwedeng-pwede po! Pwede po nating gawing 0% Sugar (unsweetened) para malasang-malasa ang natural espresso and milk. Anong drink po ang gusto ninyong i-zero sugar?'
  },
  {
    stage: 2,
    category: 'order_customization',
    user: 'One hot flat white and one slice of blueberry cheesecake, please.',
    assistant: 'Excellent choice! For your hot Flat White, whole milk po ba ang preference niyo or plant-based milk like Oat Milk? The cheesecake will be served fresh and chilled!'
  },
  {
    stage: 2,
    category: 'order_customization',
    user: 'pde b hiwalay ung ice s kape? bka matunaw kse s byahe',
    assistant: 'Opo naman! Pwede po nating i-separate ang ice into a dedicated pouch para hindi maging matubig ang kape habang nasa biyahe.'
  },
  {
    stage: 2,
    category: 'order_customization',
    user: 'pa add ng 1 cinnamon roll tsaka 1 croissant bagong bake ba yan?',
    assistant: 'Yes po, fresh from the oven kaninang umaga! Gusto niyo po bang ipa-init (toast) pa namin sandali bago i-pack?'
  },
  {
    stage: 2,
    category: 'order_customization',
    user: '1 iced mocha 22oz, extra shot, 50% sugar',
    assistant: 'Noted on that: 1x Iced Mocha (22oz), with 1 Extra Espresso Shot (+₱35) and 50% sweetness. May food or pastries pa po ba kayong gustong idagdag?'
  },
  {
    stage: 2,
    category: 'order_customization',
    user: 'may keto meal ba kayo? bawal carbs sakin eh',
    assistant: 'Yes po! Meron tayong Keto Bacon, Mushroom & Cheese Omelette bowl without rice, plus pure Americano or Cold Brew with zero sugar!'
  },
  {
    stage: 2,
    category: 'order_customization',
    user: 'dalwang iced americano 16oz paps ung matapang',
    assistant: 'Copy lodi! 2x Iced Americano (16oz). Regular double shot po naturally yan. Gusto niyo po bang gawing triple shot (+₱35 each) para extra gising?'
  },
  {
    stage: 2,
    category: 'order_customization',
    user: 'anong difference ng spanish latte sa regular latte?',
    assistant: 'Ang Spanish Latte po ay may kasamang condensed milk kaya mas rich, creamy, at naturally sweet po siya kumpara sa standard plain caffe latte!'
  },
  {
    stage: 2,
    category: 'order_customization',
    user: 'pa order po dirty horchata meron ba?',
    assistant: 'Yes po, house specialty po namin yan! Rice milk with cinnamon topped with an espresso shot. What size po, 16oz or 22oz?'
  },
  {
    stage: 2,
    category: 'order_customization',
    user: '1 bacon silog scrambled egg tpos 1 cold brew 16oz',
    assistant: 'Noted po: 1x Bacon Silog with scrambled egg and garlic rice, plus 1x Cold Brew (16oz). Black lang po ba ang cold brew or with sweet cream?'
  },
  {
    stage: 2,
    category: 'order_customization',
    user: 'wla b kaung strawberry milk pra s bata?',
    assistant: 'Meron po! Our Iced Strawberry Milk is 100% caffeine-free, made with real strawberry puree and fresh milk. 16oz or 22oz po?'
  },
  {
    stage: 2,
    category: 'order_customization',
    user: 'pde p double check kung may nuts ung brownies nyo? allergic kse aq',
    assistant: 'Salamat po sa pagtanong! Ang aming classic fudge brownies ay may chopped walnuts po. But our Chocolate Chip Cookies and Cheesecakes are 100% nut-free!'
  },
  {
    stage: 2,
    category: 'order_customization',
    user: '1 iced white chocolate mocha 16oz, heavy cream imbes na regular milk',
    assistant: 'Got it po: 1x Iced White Chocolate Mocha (16oz) customized with rich Heavy Cream substitute. Ilang percent po ng sweetness ang prefer niyo?'
  },
  {
    stage: 2,
    category: 'order_customization',
    user: 'Isa pong Grilled Cheese Sandwich with Tomato Soup.',
    assistant: 'Perfect comfort food! Noted on 1x Grilled Cheese Sandwich with Tomato Soup. Would you like to pair it with an iced tea or coffee drink po?'
  },
  {
    stage: 2,
    category: 'order_customization',
    user: 'paki damihan ung garlic rice s bangus silog boss haha',
    assistant: 'Haha sure po! Add natin as Extra Garlic Rice (+₱35) para busog na busog. Sunny-side up or scrambled po ang egg?'
  },
  {
    stage: 2,
    category: 'order_customization',
    user: 'Can I customize the syrup flavor in my cold brew?',
    assistant: 'Yes! You can add vanilla, hazelnut, caramel, or sugar-free vanilla syrup for +₱25. Which one would you prefer?'
  },
  {
    stage: 2,
    category: 'order_customization',
    user: '3 iced tea 22oz ung citrus blend nyo',
    assistant: 'Noted po: 3x House Citrus Iced Tea in 22oz size. Standard sweetness po ba lahat or less sweet ang iba?'
  },
  {
    stage: 2,
    category: 'order_customization',
    user: 'pde b half cup ice lng? ayoko ng sobrang lamig',
    assistant: 'Pwedeng-pwede po! Less ice / half ice option noted for your drink.'
  },
  {
    stage: 2,
    category: 'order_customization',
    user: 'goods na ko sa drinks: 1 iced latte 16oz oatmilk 50% sugar. wala na kong add na food',
    assistant: 'Perfectly captured po! 1x Iced Latte (16oz, Oat Milk, 50% Sugar). Proceed na po tayo to verify the next details!'
  },

  // Stage 3: Senior Citizen & PWD Verification & Discounts (46–65)
  {
    stage: 3,
    category: 'senior_pwd_discounts',
    user: 'Senior citizen nga pala si mama, may discount ba dito?',
    assistant: 'Yes po! May 20% Senior Citizen discount (+ VAT exemption) po tayo on her personal food and drink portion. May Senior ID po ba si mama na pwedeng i-present?'
  },
  {
    stage: 3,
    category: 'senior_pwd_discounts',
    user: 'PWD ako lods, pano apply ng discount?',
    assistant: 'May discount po kayo! Kung cash at the counter po, paki-present lang po ng physical PWD ID upon ordering. Kung GCash remote payment po, paki-send lang po ng clear photo ng ID niyo dito sa chat bago magbayad.'
  },
  {
    stage: 3,
    category: 'senior_pwd_discounts',
    user: 'Kasama ba sa discount yung order ng buong barkada ko? 5 kami eh.',
    assistant: 'Ayon po sa batas, ang 20% Senior/PWD discount ay applicable strictly po sa personal meal and drink portion lamang ng cardholder, hindi po sa buong group bill.'
  },
  {
    stage: 3,
    category: 'senior_pwd_discounts',
    user: 'gcash aq mag babayad dine in kme pero senior aq pano un?',
    assistant: 'Para po mai-apply agad natin ang discount bago magbayad sa GCash, paki-send po rito ang clear photo ng inyong valid Senior ID kasama ang buong pangalan ng cardholder!'
  },
  {
    stage: 3,
    category: 'senior_pwd_discounts',
    user: 'ayoko mag send ng photo ng ID dito baka ma-leak privacy ko eh',
    assistant: 'Naiintindihan po namin! Pwede po nating gawing standard total muna ngayon, or pwede po kayong magbayad via Cash or GCash directly sa counter pagdating niyo para physical card lang po ang ipapakita niyo.'
  },
  {
    stage: 3,
    category: 'senior_pwd_discounts',
    user: 'eto na po yung pic ng senior ID ni tatay [Image uploaded]',
    assistant: "Verified po! Confirmed po ang Senior ID under Tatay's name. I-a-apply po natin ang discount sa kanyang 1 meal and 1 drink portion."
  },
  {
    stage: 3,
    category: 'senior_pwd_discounts',
    user: 'pwd id ko to pacheck nmn kung pwde [Image uploaded]',
    assistant: 'Salamat po! Verified po ang inyong PWD ID (LGU/PDAO issued). Naka-apply na po ang 20% discount sa inyong portion.'
  },
  {
    stage: 3,
    category: 'senior_pwd_discounts',
    user: 'Pwede bang gamitin yung Senior discount kasabay nung buy-1-take-1 promo niyo?',
    assistant: 'Ayon po sa DTI regulations, hindi po pwedeng ipag-combine ang Senior/PWD discount sa ongoing promo or voucher. Pwede niyo po piliin kung alin ang mas malaking discount for you!'
  },
  {
    stage: 3,
    category: 'senior_pwd_discounts',
    user: 'National ID lang dala ko pero 62 years old na ako, pwede ba yun for Senior?',
    assistant: "Opo! Any valid government-issued photo ID (like PhilID National ID, Passport, or Driver's License) na nagpapakita na 60 years old or above na kayo ay valid po for Senior discount."
  },
  {
    stage: 3,
    category: 'senior_pwd_discounts',
    user: 'dalawa kaming PWD ng friend ko, dalawa ba ma-discount?',
    assistant: 'Opo! Basta may valid PWD ID po kayong dalawa, pareho pong may discount ang inyong respective meal and drink portions. Paki-send lang po ng photos ng parehong ID.'
  },
  {
    stage: 3,
    category: 'senior_pwd_discounts',
    user: 'expired na yung PWD ID ko last month, tatanggapin niyo pa ba?',
    assistant: 'Pasensya na po, strictly valid and unexpired government IDs lang po ang tinatanggap ng aming POS system for BIR tax compliance. Regular rate po muna tayo for now.'
  },
  {
    stage: 3,
    category: 'senior_pwd_discounts',
    user: 'May Senior discount ba kahit delivery order?',
    assistant: 'Yes po, meron pa rin! Paki-send lang po ng clear photo ng Senior ID kasama ang ID number dito sa chat para ma-apply bago i-send ang final GCash amount.'
  },
  {
    stage: 3,
    category: 'senior_pwd_discounts',
    user: 'Booklet kailangan niyo pa ba picturan?',
    assistant: 'Yung front and back po ng inyong official photo ID card sapat na po for online verification! No need na po for the booklet page.'
  },
  {
    stage: 3,
    category: 'senior_pwd_discounts',
    user: 'bat hindi buong bill ang kinaltasan ng discount? ₱1,000 order ko eh',
    assistant: 'Opo, base po kasi sa Republic Act 9994/10754, ang discount ay strictly covered sa 1 drink at 1 meal na personal consumption ng Senior/PWD cardholder lamang po.'
  },
  {
    stage: 3,
    category: 'senior_pwd_discounts',
    user: 'PWD po ako pero delivery, kailangan pa ba ipakita sa rider yung ID?',
    assistant: 'Once verified na po dito sa chat at bayad na via GCash, safe na po! Pero as a backup rule, ready niyo lang po physically in case i-check sandali ni kuya rider upon handover.'
  },
  {
    stage: 3,
    category: 'senior_pwd_discounts',
    user: 'pwd discount nga pala boss paki less',
    assistant: 'Noted po! Cash on delivery po ba ito or via GCash? Kung GCash po, paki-attach po muna ang photo ng inyong PWD ID para mai-compute ang discounted total.'
  },
  {
    stage: 3,
    category: 'senior_pwd_discounts',
    user: 'Wala akong Senior ID pero may birth certificate ako na 65 na ako pwede ba?',
    assistant: 'Kailangan po ng government-issued photo ID (like OSCA ID, National ID, or Passport) para ma-verify po ang identity and picture ninyo legally.'
  },
  {
    stage: 3,
    category: 'senior_pwd_discounts',
    user: 'Wala kaming Senior or PWD, regular order lang po kami lahat.',
    assistant: 'Copy po! Regular pricing applies, with zero discount. Proceed na po tayo sa inyong details and payment option!'
  },
  {
    stage: 3,
    category: 'senior_pwd_discounts',
    user: 'kuya ko yung PWD pero ako yung gagamit ng discount para sa kape ko pwede ba?',
    assistant: 'Naku, hindi po pwede. Non-transferable po ang Senior/PWD privilege; dapat po mismong ang may-ari ng ID ang iinom at kakain ng discounted item.'
  },
  {
    stage: 3,
    category: 'senior_pwd_discounts',
    user: 'eto po OSCA ID [Image uploaded] gcash payment po ako take out.',
    assistant: 'Received and verified po ang inyong OSCA ID! I-re-reflect po natin ang discount bago ibigay ang payment details.'
  },

  // Stage 4 & 5: Customer Details, Summaries & Final Execution (66–85)
  {
    stage: 4,
    category: 'details_summary',
    user: 'Juan Dela Cruz po name, dine in kme, cash magbabayad, no discount.',
    assistant: `Eto po ang summary ng inyong order:

Name: Juan Dela Cruz
Location: Inside Cafe (Open Seating / Counter Pickup)
Payment option: Cash
Dining mode: Dine In
Discount: ₱0.00 (None)
Order:
- 1x Iced Spanish Latte (16oz, 50% Sugar) - ₱150.00
- 1x Beef Tapa Silog (Sunny-side up egg) - ₱220.00
Total: ₱370.00 (Subtotal ₱370.00 - ₱0.00 Discount)

Tama po ba lahat ng details? Reply YES to confirm and proceed, o sabihin lang po kung may gustong palitan!`
  },
  {
    stage: 5,
    category: 'confirmation_execution',
    user: 'YES goods na yan paps!',
    assistant: 'Confirmed! Na-send na po ang order ticket niyo sa barista and kitchen. Feel free to find any available seat inside the cafe, and tawagin na lang po namin ang name niyo kapag ready na ang tray!'
  },
  {
    stage: 4,
    category: 'details_summary',
    user: 'Maria Santos, Unit 12B Tower 1 Pioneer St Mandaluyong, GCash, Delivery, may senior discount si mama.',
    assistant: `Eto po ang summary ng inyong order:

Name: Maria Santos
Location: Unit 12B Tower 1 Pioneer St Mandaluyong
Payment option: GCash
Dining mode: Delivery
Discount: ₱44.00 (Senior Citizen Discount)
Order:
- 1x Iced Caramel Macchiato (16oz, 50% Sugar) - ₱160.00
- 1x Bangus Silog (Scrambled egg) - ₱210.00
Total: ₱406.00 (Subtotal ₱370.00 - ₱44.00 Discount + ₱80.00 Delivery Fee)

Tama po ba lahat ng details? Reply YES to confirm and proceed, o sabihin lang po kung may gustong palitan!`
  },
  {
    stage: 5,
    category: 'confirmation_execution',
    user: 'yes tama lahat gcash details pls',
    assistant: `Perfect! Here are our GCash payment details:
• Account Name: [Cafe Name]
• GCash Number: 09XX-XXX-XXXX
• Amount to Pay: ₱406.00
Paki-send po ng screenshot ng transaction receipt dito kapag transferred na para mai-dispatch na po agad sa delivery rider!`
  },
  {
    stage: 4,
    category: 'details_summary',
    user: 'Mark Cruz, store pick up / take out, Cash payment pag daan ko. No discount.',
    assistant: `Eto po ang summary ng inyong order:

Name: Mark Cruz
Location: Store Counter Pickup
Payment option: Cash
Dining mode: Take Out
Discount: ₱0.00 (None)
Order:
- 2x Iced Americano (22oz, Extra Shot) - ₱310.00
- 2x Croissant (Toasted) - ₱190.00
Total: ₱500.00 (Subtotal ₱500.00 - ₱0.00 Discount)

Tama po ba lahat ng details? Reply YES to confirm and proceed, o sabihin lang po kung may gustong palitan!`
  },
  {
    stage: 5,
    category: 'confirmation_execution',
    user: 'YES proceed',
    assistant: 'Order confirmed and forwarded to the counter! Sinasalang na po ng barista. Daanan niyo na lang po sa counter pagdating niyo. Salamat po!'
  },
  {
    stage: 4,
    category: 'details_summary',
    user: 'Wait, palitan mo yung kape! Gawin mong 22oz imbes na 16oz.',
    assistant: `No problem, na-update po natin! Eto po ang revised summary:

Name: Juan Dela Cruz
Location: Inside Cafe (Open Seating / Counter Pickup)
Payment option: Cash
Dining mode: Dine In
Discount: ₱0.00 (None)
Order:
- 1x Iced Spanish Latte (22oz, 50% Sugar) - ₱175.00
- 1x Beef Tapa Silog (Sunny-side up egg) - ₱220.00
Total: ₱395.00 (Subtotal ₱395.00 - ₱0.00 Discount)

Tama po ba lahat ng details? Reply YES to confirm and proceed!`
  },
  {
    stage: 4,
    category: 'details_summary',
    user: 'Alex Reyes, 54 Kalayaan Ave QC, Cash on Delivery, with PWD discount.',
    assistant: `Eto po ang summary ng inyong order:

Name: Alex Reyes
Location: 54 Kalayaan Ave QC
Payment option: Cash
Dining mode: Delivery
Discount: ₱38.00 (PWD Discount)
Order:
- 1x Iced Matcha Latte (16oz, Oat Milk) - ₱190.00
- 1x Cinnamon Roll - ₱95.00
Total: ₱347.00 (Subtotal ₱285.00 - ₱38.00 Discount + ₱100.00 Delivery Fee)

Tama po ba lahat ng details? Reply YES to confirm and proceed, o sabihin lang po kung may gustong palitan!`
  },
  {
    stage: 5,
    category: 'confirmation_execution',
    user: 'oo tama yan yes',
    assistant: 'Order dispatched to the kitchen! Pakihanda na lang po ang exact cash amount na ₱347.00 and inyong physical PWD ID para sa delivery rider upon arrival. Salamat po!'
  },
  {
    stage: 4,
    category: 'details_summary',
    user: 'Bea Alonzo, dine in kami, GCash payment bago pumasok, with PWD ID uploaded.',
    assistant: `Eto po ang summary ng inyong order:

Name: Bea Alonzo
Location: Inside Cafe (Open Seating / Counter Pickup)
Payment option: GCash
Dining mode: Dine In
Discount: ₱32.00 (PWD Discount)
Order:
- 1x Cold Brew (16oz, Sweet Cream) - ₱160.00
- 1x Blueberry Cheesecake - ₱160.00
Total: ₱288.00 (Subtotal ₱320.00 - ₱32.00 Discount)

Tama po ba lahat ng details? Reply YES to confirm and proceed, o sabihin lang po kung may gustong palitan!`
  },
  {
    stage: 5,
    category: 'confirmation_execution',
    user: 'YES! bayaran ko na via gcash',
    assistant: 'Eto po ang aming GCash QR and Number: 09XX-XXX-XXXX ([Cafe Name]). Bayad na po via GCash once transferred! Pagdating po sa shop, pakihanap lang po ang any free seat and paki-pakita na lang po sandali ang inyong physical ID sa counter for quick verification.'
  },
  {
    stage: 4,
    category: 'details_summary',
    user: 'mali yung address, sa #14 Acacia St Mandaluyong dapat',
    assistant: `Na-edit na po agad ang address! Eto po ang updated summary:

Name: Maria Santos
Location: #14 Acacia St, Mandaluyong City
Payment option: GCash
Dining mode: Delivery
Discount: ₱44.00 (Senior Citizen Discount)
Order:
- 1x Iced Caramel Macchiato (16oz, 50% Sugar) - ₱160.00
- 1x Bangus Silog (Scrambled egg) - ₱210.00
Total: ₱406.00 (Subtotal ₱370.00 - ₱44.00 Discount + ₱80.00 Delivery Fee)

Tama na po ba lahat? Reply YES to confirm!`
  },
  {
    stage: 5,
    category: 'confirmation_execution',
    user: 'YES tama na',
    assistant: 'Perfect! Order finalized and forwarded for dispatch. I-update po namin kayo kapag on the way na si kuya rider!'
  },
  {
    stage: 4,
    category: 'details_summary',
    user: 'Carlo D., Take Out, GCash payment now, senior discount ID verified.',
    assistant: `Eto po ang summary ng inyong order:

Name: Carlo D.
Location: Store Counter Pickup
Payment option: GCash
Dining mode: Take Out
Discount: ₱30.00 (Senior Citizen Discount)
Order:
- 1x Hot Americano (16oz) - ₱120.00
- 1x Bacon & Egg Platter - ₱200.00
Total: ₱290.00 (Subtotal ₱320.00 - ₱30.00 Discount)

Tama po ba lahat ng details? Reply YES to confirm and proceed, o sabihin lang po kung may gustong palitan!`
  },
  {
    stage: 5,
    category: 'confirmation_execution',
    user: 'Yes proceed po',
    assistant: 'Thank you po! Paki-settle na lang po ng ₱290.00 sa GCash 09XX-XXX-XXXX. Sinasalang na po ang order para ready na pagdaan niyo!'
  },
  {
    stage: 5,
    category: 'confirmation_execution',
    user: 'eto receipt [Screenshot of GCash transfer ₱290]',
    assistant: 'Payment verified and confirmed! Nakasalang na po sa bar ang inyong Hot Americano and Bacon Platter. Ready for pickup in 10-15 minutes po!'
  },
  {
    stage: 4,
    category: 'details_summary',
    user: 'Jenny Tan, Dine In, Cash, no discount, 4 pax kami.',
    assistant: `Eto po ang summary ng inyong order:

Name: Jenny Tan
Location: Inside Cafe (Open Seating / Counter Pickup)
Payment option: Cash
Dining mode: Dine In
Discount: ₱0.00 (None)
Order:
- 4x Iced Spanish Latte (16oz, 50% Sugar) - ₱600.00
- 2x Cheesy Beef Lasagna - ₱440.00
Total: ₱1,040.00 (Subtotal ₱1,040.00 - ₱0.00 Discount)

Tama po ba lahat ng details? Reply YES to confirm and proceed, o sabihin lang po kung may gustong palitan!`
  },
  {
    stage: 5,
    category: 'confirmation_execution',
    user: 'yes yes tama lahat thank you!',
    assistant: 'Confirmed! Order ticket sent to kitchen and espresso bar. Feel free to grab any available 4-seater table or combine tables inside. Enjoy po!'
  },
  {
    stage: 4,
    category: 'details_summary',
    user: 'Daniel Padilla, delivery sa Boni Ave Mandaluyong, Cash on delivery, no discount.',
    assistant: `Eto po ang summary ng inyong order:

Name: Daniel Padilla
Location: 88 Boni Ave, Plainview, Mandaluyong City
Payment option: Cash
Dining mode: Delivery
Discount: ₱0.00 (None)
Order:
- 1x Iced Mocha (22oz) - ₱180.00
- 1x Pork Tocino Silog - ₱190.00
Total: ₱440.00 (Subtotal ₱370.00 - ₱0.00 Discount + ₱70.00 Delivery Fee)

Tama po ba lahat ng details? Reply YES to confirm and proceed, o sabihin lang po kung may gustong palitan!`
  },
  {
    stage: 5,
    category: 'confirmation_execution',
    user: 'G na g, YES!',
    assistant: 'Awesome! Dispatched na po sa kitchen queue ang inyong order. Kuya rider will deliver to Boni Ave shortly. Pakihanda po ang ₱440.00 upon arrival!'
  },

  // Edge Cases, Heavy Typos, Slang & Corrections (86–100)
  {
    stage: 'edge',
    category: 'typos_slang_corrections',
    user: 'hm po 1 iced latet tska 1 chzckake p deliver',
    assistant: 'Hello po! Ang Iced Latte natin ay ₱140 (16oz) and Cheesecake ay ₱160. Deliver po natin yan! Anong sweetness level po ng latte ang gusto niyo?'
  },
  {
    stage: 'edge',
    category: 'typos_slang_corrections',
    user: 'sn n po order q bkt wla p rider kanina p aq nag gcash',
    assistant: 'Pasensya na po sa delay! Chine-check ko po agad sa live delivery tracker. Pwede pong mahingi ang inyong Name or Order Reference number para ma-contact natin si kuya rider?'
  },
  {
    stage: 'edge',
    category: 'typos_slang_corrections',
    user: 'pa cancel nlng nung order bglang nagka emergency eh',
    assistant: 'Naku, copy po! Chineck ko po sa kitchen and pending pa naman po ang ticket. Successfully cancelled na po ang order niyo. Ingat po kayo!'
  },
  {
    stage: 'edge',
    category: 'typos_slang_corrections',
    user: 'w8 lng lods check q lng gcash wallet q kng my laman pa haha',
    assistant: 'Haha take your time lodi! No rush po, naka-hold lang po ang order list niyo dito hanggang ready na kayo mag-checkout.'
  },
  {
    stage: 'edge',
    category: 'typos_slang_corrections',
    user: 'bat may ₱80 delivery fee eh malapit lng kme dyn',
    assistant: 'Third-party courier live rate po kasi ang sinusunod natin for dispatch, pero if within 1km lang po kayo, pwede rin po nating i-book via direct store walking courier for only ₱40!'
  },
  {
    stage: 'edge',
    category: 'typos_slang_corrections',
    user: 'mali napindot ko gcash pala dapat hindi cash',
    assistant: 'Walang problema! Na-update po natin to GCash payment. Eto po ang payment number: 09XX-XXX-XXXX. Send niyo na lang po ang screenshot receipt after transfer.'
  },
  {
    stage: 'edge',
    category: 'typos_slang_corrections',
    user: 'pwd po aq kso naiwan q id ko sa bahay pero nsa cafe n ko',
    assistant: 'Aww pasensya na po, strictly required po kasi ng POS system namin ang physical or digital photo ng ID para ma-scan at ma-reimburse ng cashier. Regular rate po muna tayo today if walang copy.'
  },
  {
    stage: 'edge',
    category: 'typos_slang_corrections',
    user: 'Legit b na masarap lasgna nyo? Bka puro tomato sauce lng ha haha',
    assistant: 'Haha legit 100% pure ground beef, creamy bechamel, at thick melted mozzarella cheese po yan! Hindi tinipid sa ingredients, promise!'
  },
  {
    stage: 'edge',
    category: 'typos_slang_corrections',
    user: 'pde p humingi ng extra tissue tska utensils s delivery paki lagay s pouch',
    assistant: 'Noted po with extra care! Nag-add na po ako ng high-priority note sa packaging team for complete disposable cutlery and extra napkins.'
  },
  {
    stage: 'edge',
    category: 'typos_slang_corrections',
    user: 'bossing pde pa habol 1 extra bottle ng water?',
    assistant: 'Yes po, naidagdag na po: 1x Bottled Mineral Water (+₱30) bago i-seal ang delivery bag!'
  },
  {
    stage: 'edge',
    category: 'typos_slang_corrections',
    user: 'nag error po gcash ko nag deduct pero di nag generate ng reference number',
    assistant: "Don't worry po! Paki-send lang po ng screenshot ng inyong GCash transaction history or SMS confirmation showing the timestamp and amount, and i-ve-verify po agad ng aming cashier sa portal."
  },
  {
    stage: 'edge',
    category: 'typos_slang_corrections',
    user: 'Matsala lodi! Da best kape nyo laging gising sa shift!',
    assistant: 'Maraming salamat po lodi! Sobrang appreciated po ng support niyo. Enjoy your coffee and ingat lagi sa shift!'
  },
  {
    stage: 'edge',
    category: 'typos_slang_corrections',
    user: 'pwede ba humingi ng resibo na may TIN number ng company namin para sa reimbursement?',
    assistant: 'Opo, nag-i-issue po kami ng official BIR receipt! Paki-provide lang po ng inyong Registered Company Name, Address, at TIN para mai-encode ng cashier.'
  },
  {
    stage: 'edge',
    category: 'typos_slang_corrections',
    user: 'asan na order ko? malamig na siguro yung pagkain',
    assistant: 'Naka-insulated thermal delivery bag po ang ating items para manatiling mainit ang food and malamig ang drinks! Paki-send po ng name niyo para ma-ping po agad si kuya rider sa GPS.'
  },
  {
    stage: 'edge',
    category: 'typos_slang_corrections',
    user: 'goods na boss bayad na ko sa gcash eto ref number 1029384756',
    assistant: 'Verified and confirmed ref #1029384756! Pasok na po sa queue. Maraming salamat po sa inyong order and have a great day ahead!'
  }
];

module.exports = {
  STAGE_PIPELINE_100_DATASET
};
