# 🎓 Thesis Defense Reviewer & Q&A Master Guide

**Research Title:** *An AI-Powered Conversational Cafe Operations and Smart Delivery Management System Using Facebook Messenger Integration for Diner's Cafe*  
**Proponents:** Capstone Research Group  
**Target Standard:** ISO/IEC 25010 Software Quality Model  

---

## 📌 Part 1: System Quick Cheat Sheet (Kabiserahin Ito!)

| Item | System Implementation Details |
| :--- | :--- |
| **Primary AI Model** | **Google Gemini (`gemini-3.8-flash`)** via `@google/genai` SDK |
| **Fallback AI Model** | `gemini-3.5-flash-lite` (auto-failover kapag may network spike) |
| **Backend Framework** | **Node.js with Express.js** (REST API & HTTPS Webhooks) |
| **Messaging Channel** | **Meta Facebook Messenger Platform (Graph API v21.0)** |
| **Database** | **MySQL / TiDB Relational Database** (Centralized) |
| **Real-time Push Alerts** | **Server-Sent Events (SSE)** for Admin Dashboard + Messenger Send API for Customers |
| **Payment Options** | **Cash on Delivery (COD)** at **GCash** (Manual Reference Validation + Admin Audit) |
| **Delivery Model** | **Milestone-Based Smart Tracking** (Pending ➔ Preparing ➔ Dispatched ➔ Delivered) via dedicated **Rider Portal** *(Hindi GPS map)* |
| **Inventory System** | **Bill of Materials (BOM)** Recipe-based automatic deduction per menu item sold |
| **Evaluation Model** | **ISO/IEC 25010** (Functional Suitability, Usability, Reliability, Performance, Security, Maintainability) |
| **Research Design** | **Developmental Research** with **Agile (Scrum)** Methodology |

---

## 🎯 Part 2: The Top 5 "Killer" Panelist Questions & Exact Answers

### Q1: "What specific AI model are you using, and why did you choose it?"
> **Winning Answer:**  
> *"Our system integrates **Google Gemini 3.8 Flash (`gemini-3.8-flash`)** as our primary model, utilizing the official `@google/genai` Interactions SDK. We selected Gemini 3.8 Flash because it offers sub-second inference speeds, native multimodal handling, high cost-efficiency, and exceptional capability in understanding colloquial Filipino and Taglish dialogues. Furthermore, we implemented an automated resilience fallback to **Gemini 3.5 Flash Lite** to ensure 100% system uptime in the event of rate limits or intermittent API spikes."*

---

### Q2: "How exactly does Facebook Messenger communicate with your backend system?"
> **Winning Answer:**  
> *"Facebook Messenger connects to our system via **HTTPS Webhooks** and the **Meta Graph API v21.0**.  
> 1. When a customer sends a message on Messenger, Meta's servers dispatch a POST request payload containing the customer's Page-Scoped ID (PSID) and message text to our webhook endpoint (`/api/webhook`).  
> 2. Our Node.js/Express backend validates the cryptographic signature (`X-Hub-Signature-256`), extracts the conversation, and passes it to our Gemini AI engine.  
> 3. After generating the structured response and updating the database, our backend calls the **Messenger Send API** to deliver the text, quick replies, or receipt templates directly back to the customer's chat screen."*

---

### Q3: "How does your system verify GCash payments if the customer only enters an amount?"
> **Winning Answer:**  
> *"Our system enforces a two-tier verification process:  
> 1. **Automated Validation:** The AI chatbot collects the exact amount paid and the official GCash Reference Number from the customer, instantly validating that the amount entered matches or exceeds the computed order total.  
> 2. **Administrative Audit:** The order is held in `Pending Payment Verification` status on the Admin Dashboard. The café staff cross-references the customer's submitted Reference Number against the café's actual GCash merchant SMS/app alert before toggling the status to `Preparing`. This prevents fraudulent orders from reaching the kitchen without adding third-party gateway overhead."*

---

### Q4: "What makes your system different from existing food ordering platforms like GrabFood or Foodpanda?"
> **Winning Answer:**  
> *"Our system differs in three distinct aspects:  
> 1. **Zero App Barrier:** Customers order directly within Facebook Messenger—an app they already use daily—without downloading third-party apps or creating new accounts.  
> 2. **Direct Café Ownership & Zero Commission:** Third-party platforms deduct 20% to 30% commission per order. Our system provides Diner's Café with its own internal digital ordering and dispatch ecosystem.  
> 3. **Deep Operational Integration:** GrabFood does not manage internal raw ingredient recipes or café inventory. Our system links customer chat orders directly to recipe ingredient deduction (Bill of Materials) and internal rider dispatch in real time."*

---

### Q5: "How can you prove that your proposed system actually improves Diner's Café operations?"
> **Winning Answer:**  
> *"We prove this through rigorous **ISO/IEC 25010 Software Quality Evaluation** and pre/post operational comparative metrics. We evaluate:  
> - **Response Time:** From manual minutes of waiting for a staff reply to instantaneous automated AI replies in under 2 seconds.  
> - **Order Accuracy:** Eliminating verbal/miswritten order errors via structured receipt confirmation before database committing.  
> - **Inventory Transparency:** Automated recipe stock deductions replacing manual end-of-day stock counting.  
> - **Statistical Acceptability:** Measuring mean ratings from customers, staff, management, and IT experts across functional suitability, usability, and reliability."*

---

## 🧠 Part 3: Technical Q&A (Deep Dive)

### Q6: "Why is your system called 'AI-Powered' instead of just a rule-based chatbot?"
> **Answer:**  
> *"A rule-based chatbot relies strictly on rigid button clicks or exact keyword matching (if-else statements). If a customer types 'pabili nga ng tatlong kape pero wag masyadong matamis at paki-separate yung creamer', a rule-based bot will fail.  
> Our system uses a **Hybrid Conversational AI Engine**:  
> 1. **Natural Language Understanding (NLU):** Gemini parses informal Taglish sentences, typos, and multi-intent messages.  
> 2. **Contextual Memory:** It remembers previous turns (e.g., when the customer says 'dagdagan mo pa ng isa').  
> 3. **Structured Entity Extraction:** It extracts items, quantities, and customizations into structured JSON data while retrieving live prices directly from MySQL."*

### Q7: "What prevents the AI chatbot from hallucinating fake menu items or wrong prices?"
> **Answer:**  
> *"We implement **Grounding and RAG-Lite Context Injection**. The AI model is never allowed to guess prices or inventory. Before generating a response, our backend queries the MySQL database for the current, active menu items, prices, and stock levels, and injects this authoritative data into the system prompt. If an item is out of stock in the database, the prompt explicitly instructs the AI that the item is unavailable."*

### Q8: "How does your Smart Delivery Management work without GPS live pin tracking?"
> **Answer:**  
> *"In software engineering, 'smart' does not exclusively mean satellite GPS pins. In our system, **Smart Delivery Management** refers to:  
> 1. **Dynamic Fare Calculation:** Automatically calculating delivery charges based on zone/distance parameters stored in the database.  
> 2. **Rider Portal Integration:** Internal riders have their own mobile-friendly web portal to view queue tickets, accept deliveries, and confirm drop-offs.  
> 3. **Automated Event-Driven Notifications:** When a rider marks an order 'Dispatched' or 'Delivered', the system triggers instant real-time notifications to the customer via Messenger and updates the live Admin Dashboard via SSE."*

### Q9: "What is Server-Sent Events (SSE) and why did you use it instead of WebSockets or polling?"
> **Answer:**  
> *"Server-Sent Events (SSE) is an HTTP-based standard that allows our backend server to push real-time updates to the browser client over a single, persistent HTTP connection.  
> We chose SSE over WebSockets because our dashboard notifications are unidirectional (server-to-client alerts whenever a new order arrives or a rider updates a status). SSE is lightweight, operates over standard HTTP/HTTPS without extra handshake protocols, and has native automatic reconnection."*

### Q10: "What happens if two customers order the last remaining stock at the same exact second?"
> **Answer:**  
> *"Our system uses **ACID-compliant MySQL database transactions**. When an order confirmation is triggered, the database initiates a transactional query with row locking (`SELECT ... FOR UPDATE` or conditional update `WHERE stock >= quantity`). The first transaction commits and deducts the inventory; the second transaction immediately detects that stock is zero, rolls back, and the AI chatbot informs the second customer that the item was just sold out."*

---

## 📊 Part 4: Research Methodology Q&A

### Q11: "Why did you use Developmental Research Design?"
> **Answer:**  
> *"We utilized Developmental Research because the primary goal of our study is to systematically design, develop, test, and evaluate an instructional or technological product (the café operations and delivery management software) to solve specific operational deficiencies at Diner's Café."*

### Q12: "Explain the phases of your Agile (Scrum) Development Methodology."
> **Answer:**  
> *"We adopted Agile Scrum across 2-week iterations:  
> 1. **Sprint Planning:** Prioritizing product backlog items (e.g., Chatbot Engine, Order Dispatch, Dashboard).  
> 2. **Requirements & Design:** Crafting wireframes, database schemas, and conversational flowcharts.  
> 3. **Development (Sprints):** Coding full-stack features and API integrations.  
> 4. **Testing & QA:** Performing unit testing, integration tests, and regression testing.  
> 5. **Sprint Review & Retrospective:** Reviewing working modules with Diner's Café stakeholders and applying feedback into the next sprint."*

### Q13: "What is the difference between your Population and your Sample Size?"
> **Answer:**  
> *(Siguruhing pareho ang sasabihin ninyo rito sa Chapter 3!)*  
> *"Our target population consists of the individuals directly interacting with or evaluating the system. We employed **Purposive Sampling** to select respondents with actual operational relevance:  
> - **Customers (50):** Evaluates Usability, Functional Suitability, and Satisfaction.  
> - **Café Staff (5):** Evaluates kitchen workflow, order monitoring, and ease of use.  
> - **Management (5):** Evaluates business reporting, inventory control, and administrative efficiency.  
> - **IT Experts (5):** Evaluates code architecture, ISO/IEC 25010 security, maintainability, and performance efficiency.  
> **Total Sample Size:** 65 respondents."*

### Q14: "Why did you include IT Experts in your evaluation?"
> **Answer:**  
> *"End-users such as customers and kitchen staff can effectively rate Usability and User Satisfaction, but they cannot assess technical parameters such as code maintainability, API security, architectural reliability, and database normalization. IT Experts provide rigorous technical grounding aligned with the ISO/IEC 25010 standard."*

---

## 🛡️ Part 5: Red Flag Traps & How to Defend Them

| Panel Trap Question | Dangerous Response ❌ | Winning Professional Defense  |
| :--- | :--- | :--- |
| *"Can your chatbot replace human workers completely?"* | *"Yes, wala na pong gagawin ang staff."* | *"No, sir. Our chatbot is designed to augment and assist staff, not replace them. It automates repetitive tasks (taking inquiries, tallying bills) so staff can focus on food preparation and customer service."* |
| *"What if Meta/Facebook Messenger is down?"* | *"Wala na po, sira na yung system."* | *"Messenger is our primary consumer touchpoint. In the rare event of a Meta global outage, customer-facing chat is temporarily queued. However, internal kitchen operations, inventory records, and admin dashboard remain 100% accessible locally on the centralized server."* |
| *"Why not just use GCash QR code API directly?"* | *"Mahirap po kasi i-code."* | *"Official automated GCash merchant APIs require registered corporate SEC business licenses, high monthly transaction volume commitments, and merchant gateway processing fees. For an MSME café like Diner's Café, manual reference validation with amount verification is the most practical and legally compliant implementation."* |
| *"Why didn't you build an Android/iOS app from scratch?"* | *"Hindi po kami marunong mag-mobile app."* | *"Developing a native app creates friction: customers resist downloading a 50MB app just to order coffee from a local café. Messenger already has over 90% smartphone penetration in the Philippines, providing zero download friction."* |

---

## 💡 Part 6: Defense Day Golden Rules

1. **Never Say "Hindi po namin alam"**:  
   Instead say: *"That is an insightful observation, sir/ma'am. In our current implementation, we handled it through [X], but we will certainly incorporate that as an enhancement in future recommendations."*
2. **Be Unified as a Team**:  
   When a panelist asks a question, let the primary speaker start, and a groupmate may politely supplement: *"To add to my colleague's answer..."*
3. **Point to Your Figures**:  
   Refer to **Figure 1.1** (Conceptual Framework), **Figure 3.2** (Architecture), **Figure 3.3** (Use Case), **Figure 3.4** (Network Diagram), and **Figure 3.5** (DFD / Schema) during your explanations.
