<?php
/**
 * Diner's Cafe Ordering & Delivery System
 * Standalone Backend PHP API: Account Password Reset / Update
 * 
 * Endpoint: POST /backend/php/api/update_password.php
 * Accepts: JSON payload or Form-Data (user_id, new_password, confirm_password)
 */

// 1. Set Security & Content-Type Headers
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");

// Handle preflight OPTIONS request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// Ensure request method is POST or PUT
if ($_SERVER['REQUEST_METHOD'] !== 'POST' && $_SERVER['REQUEST_METHOD'] !== 'PUT') {
    http_response_code(405);
    echo json_encode([
        "success" => false,
        "message" => "Method Not Allowed. Use POST or PUT."
    ]);
    exit();
}

// 2. Include Database Connection
require_once __DIR__ . '/../config/database.php';

$database = new Database();
$db = $database->getConnection();

// 3. Parse Incoming Request Payload (JSON or Form Data)
$raw_input = file_get_contents("php://input");
$data = json_decode($raw_input, true);

// Fallback to $_POST if json_decode returns null
if (empty($data)) {
    $data = $_POST;
}

$user_id = isset($data['user_id']) ? filter_var($data['user_id'], FILTER_VALIDATE_INT) : (isset($data['id']) ? filter_var($data['id'], FILTER_VALIDATE_INT) : null);
$new_password = isset($data['new_password']) ? trim($data['new_password']) : (isset($data['password']) ? trim($data['password']) : '');
$confirm_password = isset($data['confirm_password']) ? trim($data['confirm_password']) : null;

// 4. Server-Side Form Validation
$errors = [];

if (empty($user_id) || $user_id <= 0) {
    $errors[] = "Valid User ID is required.";
}

if (empty($new_password)) {
    $errors[] = "New password cannot be empty.";
} elseif (strlen($new_password) < 6) {
    $errors[] = "New password must be at least 6 characters in length.";
}

if ($confirm_password !== null && $new_password !== $confirm_password) {
    $errors[] = "New password and confirmation password do not match.";
}

// If validation errors exist, return 400 Bad Request
if (!empty($errors)) {
    http_response_code(400);
    echo json_encode([
        "success" => false,
        "message" => implode(" ", $errors),
        "errors"  => $errors
    ]);
    exit();
}

try {
    // 5. Verify Target User Account Exists
    $check_query = "SELECT id, full_name, email, role FROM admins_staff WHERE id = :user_id LIMIT 1";
    $check_stmt = $db->prepare($check_query);
    $check_stmt->bindParam(":user_id", $user_id, PDO::PARAM_INT);
    $check_stmt->execute();

    if ($check_stmt->rowCount() === 0) {
        http_response_code(404);
        echo json_encode([
            "success" => false,
            "message" => "User account with ID #{$user_id} not found."
        ]);
        exit();
    }

    $user = $check_stmt->fetch();

    // 6. Secure Password Hashing with PHP password_hash (BCRYPT)
    $password_hash = password_hash($new_password, PASSWORD_BCRYPT, ['cost' => 10]);

    if (!$password_hash) {
        throw new Exception("Password hashing failed internally.");
    }

    // 7. Execute SQL UPDATE Query with Prepared Statement
    $update_query = "UPDATE admins_staff 
                     SET password_hash = :password_hash, 
                         updated_at = NOW() 
                     WHERE id = :user_id";

    $update_stmt = $db->prepare($update_query);
    $update_stmt->bindParam(":password_hash", $password_hash, PDO::PARAM_STR);
    $update_stmt->bindParam(":user_id", $user_id, PDO::PARAM_INT);

    if ($update_stmt->execute()) {
        http_response_code(200);
        echo json_encode([
            "success" => true,
            "message" => "Password for {$user['full_name']} ({$user['email']}) was successfully updated.",
            "data" => [
                "user_id"    => (int)$user['id'],
                "full_name"  => $user['full_name'],
                "email"      => $user['email'],
                "role"       => $user['role'],
                "updated_at" => date("Y-m-d H:i:s")
            ]
        ]);
    } else {
        http_response_code(500);
        echo json_encode([
            "success" => false,
            "message" => "Failed to update password in database."
        ]);
    }

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        "success" => false,
        "message" => "Database Query Error: " . $e->getMessage()
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        "success" => false,
        "message" => "Server Error: " . $e->getMessage()
    ]);
}
?>
