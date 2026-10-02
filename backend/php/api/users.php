<?php
/**
 * Diner's Cafe Ordering & Delivery System
 * Standalone Backend PHP API: Staff Accounts Management (List & Create)
 * 
 * Endpoint: /backend/php/api/users.php
 * GET: List all registered staff accounts
 * POST: Create a new staff account
 */

header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

require_once __DIR__ . '/../config/database.php';

$database = new Database();
$db = $database->getConnection();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    try {
        $query = "SELECT id, full_name, email, role, phone_number, is_active, created_at, updated_at 
                  FROM admins_staff 
                  ORDER BY (role = 'admin') DESC, full_name ASC";
        $stmt = $db->prepare($query);
        $stmt->execute();
        $users = $stmt->fetchAll();

        http_response_code(200);
        echo json_encode([
            "success" => true,
            "count" => count($users),
            "users" => $users
        ]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode([
            "success" => false,
            "message" => "Failed to retrieve accounts: " . $e->getMessage()
        ]);
    }
} elseif ($method === 'POST') {
    $raw_input = file_get_contents("php://input");
    $data = json_decode($raw_input, true);
    if (empty($data)) $data = $_POST;

    $full_name = trim($data['full_name'] ?? $data['fullName'] ?? '');
    $email = trim(strtolower($data['email'] ?? ''));
    $password = trim($data['password'] ?? '');
    $role = trim($data['role'] ?? 'staff');
    $phone_number = trim($data['phone_number'] ?? $data['phoneNumber'] ?? '');

    if (empty($full_name) || empty($email) || empty($password)) {
        http_response_code(400);
        echo json_encode([
            "success" => false,
            "message" => "Full name, email, and password are required."
        ]);
        exit();
    }

    if (strlen($password) < 6) {
        http_response_code(400);
        echo json_encode([
            "success" => false,
            "message" => "Password must be at least 6 characters long."
        ]);
        exit();
    }

    try {
        // Check email uniqueness
        $check = $db->prepare("SELECT id FROM admins_staff WHERE email = :email LIMIT 1");
        $check->bindParam(":email", $email);
        $check->execute();
        if ($check->rowCount() > 0) {
            http_response_code(409);
            echo json_encode(["success" => false, "message" => "An account with this email already exists."]);
            exit();
        }

        $password_hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 10]);

        $query = "INSERT INTO admins_staff (full_name, email, password_hash, role, phone_number, is_active)
                  VALUES (:full_name, :email, :password_hash, :role, :phone_number, 1)";
        $stmt = $db->prepare($query);
        $stmt->bindParam(":full_name", $full_name);
        $stmt->bindParam(":email", $email);
        $stmt->bindParam(":password_hash", $password_hash);
        $stmt->bindParam(":role", $role);
        $stmt->bindParam(":phone_number", $phone_number);

        if ($stmt->execute()) {
            $user_id = $db->lastInsertId();
            http_response_code(201);
            echo json_encode([
                "success" => true,
                "message" => "Account created successfully.",
                "user_id" => (int)$user_id
            ]);
        }
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(["success" => false, "message" => $e->getMessage()]);
    }
}
?>
