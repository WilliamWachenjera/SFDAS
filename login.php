<?php
session_start();
include 'config.php';

if ($_SERVER["REQUEST_METHOD"] == "POST") {
    $email = $_POST['email'];
    $password = $_POST['password'];

    $stmt = $conn->prepare("SELECT * FROM users WHERE email = ?");
    $stmt->bind_param("s", $email);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($row = $result->fetch_assoc()) {
        if (password_verify($password, $row['password'])) {
            $_SESSION['user'] = $row['fullname'];
            header("Location:dashboard.html");
            exit();
        } else {
            echo "<script>alert('Invalid password.'); window.location='index.html';</script>";
        }
        $stmt->close();
        $conn->close();
    }
}
?>