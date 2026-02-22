<?php
include 'config.php';

if ($_SERVER["REQUEST_METHOD"] == "POST") {
    $token = $_POST['token'];
    $password = $_POST['password'];
    $confirm = $_POST['confirm'];

    if ($password !== $confirm) {
        echo "<script>alert('Password do not match.'); window.location='reset_password.html?token=$token';</script>";
        exit;
    }

    //hashing the new password
    $hashed = password_hash($password, PASSWORD_DEFAULT);

    $stmt = $conn->prepare("SELECT * FROM users WHERE reset_token = ?");
    $stmt->bind_param("s", $token);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($row = $result->fetch_asso()){
    $stmt = $conn->prepare("UPDATE users SET password = ?, reset_token = NULL WHERE reset_token = ?");
    $update->bind_param("ss", $hashed, $token);
    $update->execute();

    echo "<script>alert('Password reset successful! Please Log back in. we really Missed you!.'); window.location='index.html';</script>";

    } else {
    echo "<script>alert('Invalid or expired token.!'); window.location='forgot_password.html';</script";
    }
    $stmt->close();
    $conn->close();
}    

?>