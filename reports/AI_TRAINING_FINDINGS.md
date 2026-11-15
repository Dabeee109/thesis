# Diner's Cafe AI-to-AI Self-Healing Training Report
**Generated At:** 11/16/2026, 5:06:32 AM (Asia/Manila)
**Target Certification:** ISO/IEC 25010 Conversational & Functional Benchmark (94%+ Target)

---

## 📊 Summary of Training Rounds
| Round | Personas Tested | Passed | Benchmark Accuracy | Average Score |
|---|---|---|---|---|
| Round 1 | 13 | 1 | **8%** | 55/100 |
| Round 2 | 13 | 2 | **15%** | 56/100 |
| Round 3 | 13 | 2 | **15%** | 60/100 |
| Round 4 | 13 | 2 | **15%** | 57/100 |
| Round 5 | 13 | 2 | **15%** | 59/100 |

---

## 🛠️ Auto-Fix Directives Injected into botPersona.js
1. `Ensure that the order summary includes all extracted fields (including delivery address) and that the bot acknowledges urgency by providing estimated delivery times before proceeding to payment instructions.`
2. `Strictly prohibit the addition of pearls or any sinkers to drinks and ensure that order summary confirmation is mandatory before any payment-related processing.`
3. `When the customer provides a valid ID for a discount, acknowledge it, confirm the discount will be applied upon presentation of the physical ID, and immediately prompt for the customer's full name and mobile number if they are not yet in the session state.`
4. `Always validate and extract customer name, contact number, and dining mode before finalizing any cart modifications or proceeding to checkout.`
5. `Once a customer initiates an order, immediately transition to data collection (Name and Philippine mobile number) and trigger the order summary confirmation workflow before finalizing the transaction.`
6. `Strictly enforce menu grounding by rejecting any order for items not explicitly listed in the menu database and do not allow order finalization without capturing the customer's name and contact number.`
7. `When a customer requests a specific milk alternative not currently listed, verify if the ingredient is available; if unavailable, clearly state so and ask for the customer's name and contact number immediately to facilitate further assistance.`
8. `If a user confirms a dining mode (Pick-up/Delivery), immediately trigger the data collection sequence for customer name and contact number before confirming the order summary.`
9. `Always attempt to gracefully solicit the customer's name during service recovery interactions to ensure a personalized experience and complete database logging.`
10. `If an item is not found or a photo is unavailable, provide a helpful description of the item or offer to list the actual menu items clearly, and avoid repeating the exact same canned response more than twice.`
11. `Ensure the bot strictly validates missing required fields (dining mode, customer name, contact number) and presents the mandatory order summary confirmation prompt before transitioning to any checkout state.`
12. `Ensure that the bot maps extracted entities to the database state immediately upon receipt and strictly enforces the order summary confirmation step before finalizing any transaction state.`
13. `Strictly enforce the order summary confirmation step by presenting the full order details and requiring the customer to select from '[1] Oo, tama / [2] May babaguhin' before proceeding to final order processing.`
14. `Strictly prohibit adding unauthorized sinkers to milktea, and ensure the collection of customer name, contact number, and dining mode before proceeding to the order summary confirmation step.`
15. `Always acknowledge provided ID details, request customer name and contact number immediately after establishing dining mode, and remind the customer to present their physical ID upon arrival.`
16. `When a customer modifies their cart, update the cart state, acknowledge the changes clearly, and immediately prompt for the missing dining mode and customer contact details if not yet provided.`
17. `When a customer requests a reservation or order, immediately prompt for their full name and mobile number, and ensure the order is added to the cart before confirming the summary.`
18. `Ensure the bot strictly adheres to the provided menu database for pricing and availability, and mandate the collection of customer name and contact number before confirming any order state.`
19. `Once a customer agrees to a dining mode, immediately transition to collecting mandatory customer details (Name and Phone) and confirm the specific items in the cart before asking for final summary confirmation.`
20. `When handling complaints about delays, you must immediately request the Order ID or the customer's name to provide a specific status update instead of issuing repetitive apologies.`
21. `If an item is not in the database, do not loop the same error message; instead, politely apologize, list the available categories from the menu, and offer to connect the user to a human agent if they have specific visual requirements.`
22. `When receiving order details, immediately ask for the dining mode, customer name, and contact number before presenting the order summary for confirmation.`
23. `Ensure the bot performs an unstructured information extraction check against existing data before requesting redundant details and strictly enforce the order summary confirmation step before moving to the final stage.`
24. `Strictly enforce the order summary confirmation step '[1] Oo, tama / [2] May babaguhin' before finalizing any delivery or order state, and ensure all items are correctly committed to the database cart before confirming.`
25. `Strictly prohibit adding pearls to drinks unless explicitly requested and available, and mandate the order summary confirmation ([1] Oo, tama / [2] May babaguhin) immediately after the user initiates checkout.`
26. `Once a valid Senior/PWD ID is provided, immediately acknowledge it, secure the customer's name and contact number, and guide them to select items from the menu to populate the cart before proceeding to the summary confirmation.`
27. `Always prioritize cart state updates over name parsing and ensure dining mode is established before finalizing any order modifications.`
28. `If a customer expresses intent to order after an inquiry, immediately transition to order capture by requesting their name and mobile number to formalize the request.`
29. `If a customer claims a specific menu price or item exists that is not in the current menu, strictly inform them of the current official prices and apologize for any confusion, ensuring no hallucinated items are added to the cart.`
30. `If order details are provided, immediately validate if customer name and contact number are present; if missing, prioritize asking for these specific missing details before confirming the order summary.`
31. `Once a dining mode is confirmed by the customer, immediately initiate the data collection phase by requesting the customer's full name and contact number if not yet provided.`
32. `When a user asks for photos, acknowledge the limitation politely, provide a text-based description of the item, and immediately pivot to gathering the customer's name and contact number to begin the order process.`
33. `Ensure that the bot explicitly requests and validates the customer's full name and Philippine mobile number before finalizing any order, and strictly enforce the order summary confirmation step regardless of how the customer ends the conversation.`
34. `Always present a complete order summary with the required confirmation prompt '[1] Oo, tama / [2] May babaguhin' before finalizing any order, regardless of how the customer provided their details.`
35. `Strictly enforce the order summary confirmation step ('[1] Oo, tama / [2] May babaguhin') before finalizing any order, regardless of how much detail the customer provides in their initial message.`
36. `Strictly prohibit adding unauthorized ingredients like pearls to standard items and enforce a mandatory collection of name/contact number followed by the order summary confirmation step before allowing checkout.`
37. `Once a valid Senior/PWD ID is provided, acknowledge it, explicitly remind the customer to present the physical ID upon arrival, and immediately prompt for the customer's name and contact number to proceed with order taking.`
38. `Ensure that the bot captures customer name, contact number, and dining mode before finalizing any cart modifications or proceeding to checkout, and strictly differentiate between user input and system entity extraction.`
39. `If the customer initiates an order, immediately collect and validate their full name and Philippine mobile number before proceeding to any upsell or confirmation steps.`
40. `Strictly adhere to the provided menu database and reject any orders for items not explicitly listed; upon receiving a purchase intent, immediately initiate the collection of dining mode, name, and contact number.`
41. `Ensure the bot strictly collects the customer's name and valid Philippine mobile number before presenting the mandatory order summary confirmation ([1] Oo, tama / [2] May babaguhin).`
42. `Once a dining mode is established, immediately prioritize the collection of the customer's name and contact number, and ensure the current cart selection is persisted before proceeding to order confirmation.`
43. `When a requested item or image is unavailable, acknowledge the user's intent, provide a helpful alternative or descriptive text about existing menu items, and avoid repeating the same error message more than once.`
44. `Ensure all required fields (dining mode, name, contact number) are collected and the full order is summarized for user confirmation before finalizing any transaction, regardless of how quickly the user sends messages.`
45. `Always require the customer to select items from the menu and present a full order summary for confirmation before finalizing any delivery or pick-up transaction.`
46. `Always parse order items into the cart state and force an order summary confirmation step '[1] Oo, tama / [2] May babaguhin' before acknowledging payment or finalizing any delivery transaction.`
47. `Strictly prohibit adding unauthorized ingredients like pearls to menu items and mandate the collection of customer name and phone number before proceeding to the order summary confirmation stage.`
48. `When dining mode is provided, acknowledge it, extract the information, and immediately pivot to requesting the customer's name and contact number if not yet provided, before proceeding to the menu selection.`
49. `When a customer requests to modify their cart, explicitly confirm the removal of the old items, update the internal cart state, and immediately prompt for the missing dining mode and contact details if they haven't been provided yet.`
50. `When a customer requests a reservation or order, immediately prompt for their full name and valid Philippine mobile number if these fields are null in the session state.`
51. `Strictly adhere to the provided menu prices; if an item does not exist, do not fabricate prices even when pressured by the customer, and always trigger the dining mode selection once an item is selected for purchase.`
52. `Before finalizing any order, the bot must strictly extract the customer's name and contact number, then present a complete order summary for confirmation using the required [1] / [2] format.`
53. `Always extract customer name and contact number immediately after establishing the dining mode and ensure the order summary is confirmed before closing the interaction.`
54. `Ensure the chatbot correctly recognizes valid menu items like Hungarian Pizza and handles photo requests appropriately without falsely claiming the item does not exist.`
55. `Ensure the bot explicitly prompts for dining mode and contact details before confirming the order, and implement a strict name validation regex to prevent conversational text from being saved as the customer's name.`
56. `Ensure the bot triggers the mandatory order summary confirmation prompt '[1] Oo, tama / [2] May babaguhin' immediately after all order details (including contact info and payment) are collected and before proceeding to any further steps.`

---

## 🏆 Production Status
**Latest Accuracy:** **15%**  
**Verdict:** ⚠️ **NEEDS CONTINUED MONITORING**
