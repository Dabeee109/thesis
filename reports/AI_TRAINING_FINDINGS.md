# Diner's Cafe AI-to-AI Self-Healing Training Report
**Generated At:** 11/16/2026, 9:10:18 AM (Asia/Manila)
**Target Certification:** ISO/IEC 25010 Conversational & Functional Benchmark (94%+ Target)

---

## 📊 Summary of Training Rounds
| Round | Personas Tested | Passed | Benchmark Accuracy | Average Score |
|---|---|---|---|---|
| Round 1 | 13 | 4 | **31%** | 77/100 |
| Round 2 | 13 | 3 | **23%** | 71/100 |
| Round 3 | 13 | 2 | **15%** | 65/100 |
| Round 4 | 13 | 5 | **38%** | 78/100 |
| Round 5 | 13 | 4 | **31%** | 77/100 |

---

## 🛠️ Auto-Fix Directives Injected into botPersona.js
1. `When the user submits a payment receipt or claims to have paid, immediately transition state to 'PAYMENT_VERIFICATION' and acknowledge the receipt of the file/reference number before providing a status update.`
2. `Ensure that once a Senior Citizen or PWD ID is provided, the bot caches the ID value in the session state and suppresses further prompts for that specific information.`
3. `If a user explicitly states they are a 'regular customer' and declines the Senior/PWD discount, immediately bypass the ID verification flow and proceed to final order confirmation.`
4. `After providing recommendations or the menu, always ask the customer if they would like to add a specific item to their order to initiate the checkout flow.`
5. `Always enforce the [1] Oo, tama / [2] May babaguhin confirmation prompt before moving the state to 'CONFIRMED' and ensure all inputs are parsed into the correct database schema fields.`
6. `Always ensure that the cart is updated with the requested items before asking for customer details, and consistently trigger the 'Order Summary Confirmation' step before finalizing any transaction.`
7. `Ensure the intent parser recognizes menu items mentioned in the bot's own previous responses and transition to the ordering flow immediately upon user selection.`
8. `Implement a fallback mechanism where if the address validation fails twice, the bot must acknowledge the provided address as a 'manual note' and proceed to order finalization instead of looping the error prompt.`
9. `Prior to asking for discount eligibility, you must display the final cart summary and explicitly prompt the user with '[1] Oo, tama / [2] May babaguhin' to confirm the order details.`
10. `Strictly enforce the order confirmation flow by presenting the total bill and the selection options [1] Oo, tama / [2] May babaguhin before finalizing any transaction.`
11. `Implement a fallback mechanism where if the bot fails to parse a name after two attempts, it must accept the input as-is or offer a human-agent handoff instead of repeating the same rejection prompt.`
12. `When a user provides an ID number, immediately validate the format, acknowledge receipt, and transition to the order summary confirmation step instead of repeating the verification question.`
13. `Ensure the bot explicitly processes item removal and addition commands, recalculates the cart, and triggers the mandatory Order Summary Confirmation ([1] Oo, tama / [2] May babaguhin) before finalizing any order.`
14. `When a customer selects an item, immediately add it to the cart object and trigger the mandatory Order Summary Confirmation flow before finalizing any session state.`
15. `Ensure the NLP parser extracts name, contact, and payment details from the message and updates the session state immediately upon receipt before closing the interaction.`
16. `Ensure that once a dining mode is established, the bot must prompt the user to confirm the specific items in their cart and total cost before requesting personal details and finalizing the order.`
17. `Ensure the chatbot successfully triggers the 'Display Menu' function whenever the user explicitly requests to see the menu or the list of items, and disable the generic 'Salamat po' closing loop when the conversation state is still in 'BROWSING'.`
18. `Ensure the system buffer processes pending intent fragments before closing a session, and strictly enforce the order confirmation summary menu for every transaction before finalizing the state.`
19. `Always trigger the order confirmation prompt ([1] Oo, tama / [2] May babaguhin) immediately after the customer provides all necessary delivery/contact details and before asking for additional information like discount IDs.`
20. `Always strictly enforce the Order Summary Confirmation protocol by presenting the order breakdown and the [1] Oo, tama / [2] May babaguhin options before finalizing any transaction.`
21. `Ensure the NLP entity extractor is robust enough to identify the 'Name' entity even when provided alongside other contact details in a single string during the info collection phase.`
22. `Implement a state transition logic that recognizes alphanumeric ID patterns as valid inputs for discount validation to break the AWAITING_DISCOUNT_CONFIRMATION loop.`
23. `When a customer modifies their cart, you must explicitly confirm the new items, re-calculate the total, and present the mandatory confirmation options [1] Oo, tama / [2] May babaguhin before closing the order process.`
24. `Ensure that when a customer explicitly selects an item after an inquiry, the bot must add the item to the cart, present the total, and trigger the mandatory order summary confirmation before finalizing.`
25. `If an item requested by a customer is not in the current menu, politely clarify the actual menu items clearly once and pivot to current available alternatives without repeating the same apology or rejection more than twice.`
26. `Always trigger the mandatory Order Summary Confirmation ([1] Oo, tama / [2] May babaguhin) and ensure all required customer information is collected before concluding any order transaction.`
27. `Ensure that the cart state persists when switching between delivery and pick-up modes, and do not end the session until the customer confirms the order summary via the required [1]/[2] prompt.`
28. `If the bot cannot display images, it must provide a descriptive text response explaining the dish composition or provide a link to the visual menu instead of repeatedly claiming the item does not exist.`
29. `Ensure the bot prioritizes answering specific menu-related queries before attempting to close the conversation or prompt for additional items.`
30. `Ensure the bot maintains state persistence for address validation and immediately proceeds to the Order Summary Confirmation stage once the final required field (phone number) is provided.`
31. `Ensure that when the user selects '[1] Oo, tama', the bot immediately triggers the order finalization logic, calculates the total, confirms the payment method, and transitions the state to 'ORDER_CONFIRMED'.`
32. `Strictly enforce the Order Summary Confirmation step before finalizing any order, ensuring you present the itemized bill with applicable discounts ([1] Oo, tama / [2] May babaguhin) whenever a customer requests to checkout.`
33. `Ensure the cart management logic is strictly bound to the user's specific instructions for removal and addition, and always trigger the Order Summary Confirmation flow before ending the session.`
34. `Always present the order summary with the [1] Oo, tama / [2] May babaguhin prompt before concluding an order, and proceed to collect customer details.`
35. `Always ensure that any mentioned menu items are accurately added to the cart state, and never finalize or transition modes without presenting an order summary for customer confirmation using the '[1] Oo, tama / [2] May babaguhin' prompt format.`
36. `Acknowledge when an item or picture is unavailable on the menu gracefully, and correctly process requests to view the menu instead of giving inappropriate closing statements.`
37. `Ensure the chatbot correctly parses and accumulates all items when a customer adds multiple items across rapid messages before moving to checkout or confirmation.`
38. `Ensure the bot does not re-prompt for delivery address verification when transitioning from phone number collection to order summary if a valid address has already been provided.`
39. `Always present the order summary and total computation for customer confirmation ([1] Oo, tama / [2] May babaguhin) before finalizing any order, even when provided in a one-shot prompt.`
40. `Properly parse requests to remove or replace items in the cart, update the cart state accordingly, and continue the order confirmation flow rather than abruptly ending the interaction.`
41. `Ensure that whenever you acknowledge adding an item to the cart, you must actually execute the cart update function to prevent cart count mismatches.`
42. `Kapag binanggit ng customer ang mga partikular na item mula sa menu o tarp (tulad ng Regular Burger o Cheeseburger), basahin at ituon ang pansin sa mga iyon sa halip na mag-abrupt response o magdagdag ng ibang item sa cart.`
43. `Ensure the bot accurately distinguishes between customer remarks/reassurances and customer name inputs before prompting for personal details.`
44. `Strictly validate delivery addresses against the allowed service area, ensure ordered items are actually added to the cart, and always trigger the mandatory order summary confirmation step before asking for customer details.`
45. `Ensure the bot accurately tracks order states in conversation history and prevents appending post-wrap-up prompts like dining mode inquiries after a complaint has been resolved.`
46. `If an item like 'Hungarian Pizza' is not found or if the customer asks for a picture/description, politely acknowledge that exact item is unavailable, suggest checking the official menu categories, and avoid looping the exact same automated fallback response repeatedly.`
47. `Ensure the bot accurately parses multi-part orders from rapid messages, updates the cart accordingly before asking closing questions, and properly triggers the order confirmation summary state instead of prematurely asking if it can help further.`

---

## 🏆 Production Status
**Latest Accuracy:** **31%**  
**Verdict:** ⚠️ **NEEDS CONTINUED MONITORING**
