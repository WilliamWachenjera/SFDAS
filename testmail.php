<?php
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

require 'PHPMailer/PHPMailer.php';
require 'PHPMailer/SMTP.php';
require 'PHPMailer/Exception.php';

$mail = new PHPMailer(true);

try {
    $mail->isSMTP();
    $mail->Host = 'smtp.gmail.com';
    $mail->SMTPAuth = true;
    $mail->Username = 'bsc-com-ne-06-22@unima.ac.mw';
    $mail->Password = 'sfwx lynn hnkl vwut';
    $mail->SMTPSecure = 'tls';
    $mail->Port = 587;

    $mail->setFrom('bsc-com-ne-06-22@unima.ac.mw', 'SFDAS Test');
    $mail->addAddress('bsc-com-ne-06-22@unima.ac.mw');
    $mail->isHTML(true);
    $mail->Subject = 'SMTP Test';
    $mail->Body = 'If you see this, PHPMailer works!';

    $mail->send();
    echo "✅ Email sent successfully.";
} catch (Exception $e) {
    echo "❌ Error: {$mail->ErrorInfo}";
}
?>
