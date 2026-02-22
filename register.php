<?php
include 'config.php';

if ($_SERVER["REQUEST_METHOD"] == "POST") {
    $fullname = $_POST['fullname'] ?? '';
    $email = $_POST['email'] ?? '';
    $password = $_POST['password'] ?? '';

    if (!empty($fullname) && !empty($email) && !empty($password)) {
        $hashed_password = password_hash($password, PASSWORD_DEFAULT);

        $stmt = $conn->prepare("INSERT INTO users (fullname, email, password) VALUES (?, ?, ?)");
        $stmt->bind_param("sss", $fullname, $email, $hashed_password);

        if ($stmt->execute()) {
            echo "<script>alert('Registraton successful!'); window.location='index.html';</script>";
        } else {
            echo "<script>alert('Error: Email may already exist or invalid');window.location='signup.html';</script>";
        }

        $stmt->close();
    } else {
        echo "<sript>alert('Filling all fields is Mandatale.'); window.location='signup.html';</script>";
    }
    $conn->close();
}
?>

/*  
$stmt = $conn->prepare("INSERT INTO users (fullname, email, password) VALUES (?, ?, ?");
    $stmt->bind_param("sss", $fullname, $email, $password);

    if ($stmt->execute()) {
        echo "<script>alert('Registration Successsful!.'); window.location='index.html';</script>";

    } else {
        echo "<script>alert('Error: Email already exists.'); window.location='signup.html;</script>";
    }
    $stmt->close();
    $conn->close();
}
?> 
*/