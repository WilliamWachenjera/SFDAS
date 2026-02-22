<?php
include 'config.php';
require 'src/PHPMailer.php';
require 'src/SMTP.php';
require 'src/Exception.php';

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

if ($_SERVER["REQUEST_METHOD"] == "POST") {
    $email = $_POST['email'];

    $stmt = $conn->prepare("SELECT * FROM users WHERE email = ?");
    $stmt->bind_param("s", $email);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($row = $result->fetch_assoc()) {
        // Generate reset token
        $token = bin2hex(random_bytes(16));

        // Store it in the database
        $update = $conn->prepare("UPDATE users SET reset_token = ? WHERE email = ?");
        $update->bind_param("ss", $token, $email);
        $update->execute();

        // Build reset link
        $resetLink = "http://localhost/SFDAS/reset_password.html?token=$token";

        // Send email using PHPMailer
        $mail = new PHPMailer(true);

        try {
            // SMTP settings
            $mail->isSMTP();
            $mail->Host = 'smtp.gmail.com';
            $mail->SMTPAuth = true;
            $mail->Username = 'YOUR_EMAIL@gmail.com';      // <-- Replace with your email
            $mail->Password = 'YOUR_APP_PASSWORD';          // <-- Replace with app password
            $mail->SMTPSecure = 'tls';
            $mail->Port = 587;

            // Email setup
            $mail->setFrom('YOUR_EMAIL@gmail.com', 'SFDAS Support');
            $mail->addAddress($email);
            $mail->isHTML(true);
            $mail->Subject = 'Password Reset Request - SFDAS';
            $mail->Body = "
                <h3>Hello!</h3>
                <p>We received a request to reset your password. Click the link below to set a new one:</p>
                <p><a href='$resetLink'>$resetLink</a></p>
                <p>If you didn’t request this, you can ignore this message.</p>
                <br><p>Regards,<br>SFDAS Support Team</p>
            ";

            $mail->send();

            echo "<script>alert('A password reset link has been sent to your email.'); window.location='index.html';</script>";
        } catch (Exception $e) {
            echo "<script>alert('Failed to send email. Error: {$mail->ErrorInfo}'); window.location='forgot_password.html';</script>";
        }
    } else {
        echo "<script>alert('Email not found. Please try again.'); window.location='forgot_password.html';</script>";
    }

    $stmt->close();
    $conn->close();
}
?>
