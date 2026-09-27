<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Paychangu_Gateway
 */
class Paychangu_Gateway extends WC_Payment_Gateway {

	/**
	 * Checkout page title
	 *
	 * @var string
	 */
	public $title;

	/**
	 * Checkout page description
	 *
	 * @var string
	 */
	public $description;

	/**
	 * Is gateway enabled?
	 *
	 * @var bool
	 */
	public $enabled;

	/**
	 * API public key.
	 *
	 * @var string
	 */
	public $public_key;

	/**
	 * API secret key.
	 *
	 * @var string
	 */
	public $secret_key;

    /**
     * Invoice Prefix for the webiste
     * @var string
     */
    public $invoice_prefix;

    /**
     * PayChangu Webhook Secret Key.
     *
     * @var string
     */
    public $webhook_secret;
    
	/**
	 * Constructor
	 */
	public function __construct() {
		$this->id  = 'paychangu';
        $this->icon = PAYCHANGU_GATEWAY_URL . '/assets/images/icon.png';
        $this->has_fields = true;
		$this->method_title = 'PayChangu';
		$this->method_description = 'Pay with PayChangu';
        $this->order_button_text = __( 'Proceed to PayChangu', 'paychangu' );
		$this->supports = array(
			'products',
		);

		// Load the form fields.
		$this->init_form_fields();

		// Load the settings.
		$this->init_settings();

		// Get setting values.
		$this->title = $this->get_option( 'title' );
		$this->description = $this->get_option( 'description' );
		$this->enabled = $this->get_option( 'enabled' );
		$this->public_key = $this->get_option( 'public_key' );
		$this->secret_key = $this->get_option( 'secret_key' );
        $this->invoice_prefix = $this->get_option( 'invoice_prefix' );
        $this->webhook_secret = $this->get_option( 'webhook_secret' );

		// Hooks.
		add_action( 'admin_notices', array( $this, 'admin_notices' ) );
		add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, array( $this, 'process_admin_options' ) );
		// Payment listener/API hook.
		add_action( 'woocommerce_api_paychangu_gateway', array( $this, 'verify_paychangu_transaction' ) );
		// Webhook listener/API hook.
		add_action( 'woocommerce_api_paychangu_success', array( $this, 'process_success' ) );
        add_action( 'woocommerce_api_paychangu_proceed', array( $this, 'paychangu_proceed' ) );
        add_action( 'woocommerce_api_paychangu_webhook', array( $this, 'handle_webhook' ) );
	}

	/**
     * @param bool $string
     * @return array|string
     * Get currently supported currencies from Paychangu
     */
    public function get_supported_currencies($string = false) {
	    $currency_array = array('MWK', 'NGN', 'ZAR', 'GBP', 'USD');
		if ($string === true) {
			return implode(", ", $currency_array);
		}
		return $currency_array;
    }

	/**
	 * Check if Paychangu merchant details is filled
	 */
	public function admin_notices() {

		if ( 'no' === $this->enabled ) {
			return;
		}

		// Check required fields.
		if ( ! ( $this->public_key && $this->secret_key ) ) {
			echo '<div class="error"><p>Please enter your Paychangu merchant details <a href="' . esc_url(admin_url( 'admin.php?page=wc-settings&tab=checkout&section=paychangu' )) . '">here</a> to be able to use the PayChangu WooCommerce Gateway plugin.</p></div>';
			return;
		}

	}

	/**
	 * Check if Paychangu gateway is enabled.
	 */
	public function is_available() {

		if ( 'yes' === $this->enabled ) {

			if ( ! ( $this->public_key && $this->secret_key ) ) {

				return false;

			}

			return true;

		}

		return false;

	}

	/**
	 * Admin Panel Options
	 */
	public function admin_options() { ?>
		<h3>Paychangu</h3>
		<h4>Our Supported Currencies: <?php echo esc_html($this->get_supported_currencies(true)); ?></h4>
		<table class="form-table">
		    <?php $this->generate_settings_html(); ?>
            <tr valign="top">
                <th scope="row">
                    <?php esc_html_e( 'Webhook URL', 'paychangu' ); ?>
                </th>

                <td>
                    <input
                        type="text"
                        id="paychangu_webhook_url"
                        readonly
                        value="<?php echo esc_attr( WC()->api_request_url( 'paychangu_webhook' ) ); ?>"
                        style="width: 500px;"
                        onclick="this.select();"
                    />

                    <button
                        type="button"
                        class="button"
                        id="paychangu_copy_webhook_url"
                    >
                        <?php esc_html_e( 'Copy URL', 'paychangu' ); ?>
                    </button>

                    <p class="description">
                        <?php esc_html_e( 'Add this URL to your PayChangu dashboard webhook settings.', 'paychangu' ); ?>
                    </p>

                    <script>
                        document.getElementById('paychangu_copy_webhook_url').addEventListener('click', function () {
                            var input = document.getElementById('paychangu_webhook_url');

                            input.select();
                            input.setSelectionRange(0, 99999);

                            navigator.clipboard.writeText(input.value);

                            this.textContent = 'Copied!';

                            setTimeout(function () {
                                document.getElementById('paychangu_copy_webhook_url').textContent = 'Copy URL';
                            }, 2000);
                        });
                    </script>
                </td>
            </tr>
		</table>
	<?php }

	/**
	 * Initialise Gateway Settings Form Fields
	 */
	public function init_form_fields() {

		$this->form_fields = array(
			'enabled'         => array(
				'title'       => __( 'Enable/Disable', 'paychangu' ),
				'label'       => __( 'Enable PayChangu Geteway', 'paychangu' ),
				'type'        => 'checkbox',
				'description' => __( 'Enable PayChangu as a payment option on the checkout page.', 'paychangu' ),
				'default'     => 'yes',
				'desc_tip'    => false
			),
			'title'           => array(
				'title'       => __( 'Title', 'paychangu' ),
				'type'        => 'text',
				'description' => __( 'This controls the payment method title which the user sees during checkout.', 'paychangu' ),
				'desc_tip'    => false,
				'default'     => __( 'Paychangu', 'paychangu' ),
			),
			'description'     => array(
				'title'       => __( 'Description', 'paychangu' ),
				'type'        => 'textarea',
				'description' => __( 'This controls the payment method description which the user sees during checkout.', 'paychangu' ),
				'desc_tip'    => false,
				'default'     => __( 'PayChangu via your debit, credit card & Mobile Money', 'paychangu' ),
			),
            'invoice_prefix' => array(
                'title'       => __( 'Invoice Prefix', 'paychangu' ),
                'type'        => 'text',
                'description' => __( 'Please enter a prefix for your invoice numbers. If you use your Paychangu account for multiple stores ensure this prefix is unique as Paychangu will not allow orders with the same invoice number.', 'paychangu' ),
                'default'     => 'WC_',
                'desc_tip'    => false,
            ),
			'public_key' => array(
				'title'       => __( 'Public Key', 'paychangu' ),
				'type'        => 'text',
				'description' => __( 'Required: Enter your Public Key here. You can get your Public Key from <a href="https://dashboard.paychangu.com/manage/settings?_tab=api">here</a>', 'paychangu' ),
				'default'     => '',
				'desc_tip'    => false,
			),
			'secret_key' => array(
				'title'       => __( 'Secret Key', 'paychangu' ),
				'type'        => 'text',
				'description' => __( 'Required: Enter your Secret Key here. You can get your Secret Key from <a href="https://dashboard.paychangu.com/manage/settings?_tab=api">here</a>', 'paychangu' ),
				'default'     => '',
				'desc_tip'    => false,
			),
            'webhook_secret' => array(
                'title'       => __( 'Webhook Secret Key', 'paychangu' ),
                'type'        => 'password',
                'description' => __( 'Enter the Web Secret Key from your PayChangu dashboard.', 'paychangu' ),
                'default'     => '',
                'desc_tip'    => false,
            )
		);

	}

	/**
	 * Payment form on checkout page
	 */
	public function payment_fields() {
		if ( $this->description ) {
			// echo esc_html( wpautop( wptexturize( $this->description ) ) );
			echo wpautop( wptexturize( $this->description ) );
		}

		if ( ! is_ssl() ){
			return;
		}
	}

    /**
     * Process the payment and return the result.
     *
     * @param  int $order_id Order ID.
     * @return array
     */
    public function process_payment( $order_id ) {
        global $woocommerce;
        $order = new WC_Order( $order_id );
        // Remove cart
        $woocommerce->cart->empty_cart();
        $currency = $order->get_currency();
        $currency_array = $this->get_supported_currencies();
        $currency_code = in_array( $currency , $currency_array ) ? $currency : '';
        $secret_key = urlencode($this->secret_key);
        $tx_ref = urlencode($this->invoice_prefix . $order_id . strtotime('now'));
        $amount = urlencode($order->get_total());
        $email = urlencode($order->get_billing_email());
		$callback_url = urlencode(WC()->api_request_url( 'Paychangu_Success' ));
        $first_name = urlencode($order->get_billing_first_name());
        $last_name = urlencode($order->get_billing_last_name());
		$title = urlencode("Payment For Items on " . get_bloginfo('name'));
        $url = WC()->api_request_url( 'Paychangu_Proceed' ) . "?order_id={$order_id}&secret_key={$secret_key}&callback_url={$callback_url}&return_url={$callback_url}&tx_ref={$tx_ref}&amount={$amount}&email={$email}&first_name={$first_name}&last_name={$last_name}&title={$title}&currency={$currency_code}";
        // Return to Paychangu Proceed page for the next step
        return array(
            'result' => 'success',
            'redirect' => $url
        );
    }

    /**
     * API page to handle the callback data from Paychangu
     */
    public function process_success(){
		$tx_ref = sanitize_text_field($_GET['tx_ref']);
        if ($tx_ref) {
            // Verify Paychangu payment
            $paychangu_request = wp_remote_get(
                'https://api.paychangu.com/verify-payment/' . $tx_ref,
				[
					'method' => 'GET',
					'headers' => [
						'content-type' => 'application/json',
						'Authorization' => 'Bearer ' . $this->secret_key,
					]
				]
            );
            if ( ! is_wp_error( $paychangu_request ) && 200 == wp_remote_retrieve_response_code( $paychangu_request ) ) {
                $paychangu_order = json_decode( wp_remote_retrieve_body( $paychangu_request ) );
                $status = $paychangu_order->status;
				$order_id = $paychangu_order->data->meta->order_id;
            	$wc_order = wc_get_order($order_id);
                if ($status === "success") {
                    $order_total = floatval(preg_replace('/[^\d\.]+/', '', $wc_order->get_total()));
                    $amount_paid = floatval(preg_replace('/[^\d\.]+/', '', $paychangu_order->data->amount));
                    $order_currency = $wc_order->get_currency();
                    $currency_symbol = get_woocommerce_currency_symbol( $order_currency );
                    if ($amount_paid < $order_total) {
                        // Mark as on-hold
                        $wc_order->update_status('on-hold','' );
                        update_post_meta( $order_id, '_transaction_id', $tx_ref );
                        $notice      = 'Thank you for shopping with us.<br />Your payment was successful, but the amount paid is not the same as the total order amount.<br />Your order is currently on-hold.<br />Kindly contact us for more information regarding your order and payment status.';
                        $notice_type = 'notice';
                        // Add Customer Order Note
                        $wc_order->add_order_note( $notice, 1 );
                        // Add Admin Order Note
                        $wc_order->add_order_note( '<strong>Look into this order</strong><br />This order is currently on hold.<br />Reason: Amount paid is less than the total order amount.<br />Amount Paid was <strong>' . $currency_symbol . $amount_paid . '</strong> while the total order amount is <strong>' . $currency_symbol . $order_total . '</strong><br /><strong>Reference ID:</strong> ' . $tx_ref);

                        wc_add_notice( $notice, $notice_type );
                    } else {
                        // Complete order
                        $wc_order->payment_complete( $tx_ref );
                        $wc_order->add_order_note( sprintf( 'Payment via PayChangu successful (<strong>Reference ID:</strong> %s)', $tx_ref ) );
                    }
                    wp_redirect($this->get_return_url($wc_order));
                    die();
                } else if ($status === "cancelled") {
                    $wc_order->update_status( 'canceled', 'Payment was canceled.' );
                    wc_add_notice( 'Payment was canceled.', 'error' );
                    // Add Admin Order Note
                    $wc_order->add_order_note('Payment was canceled by PayChangu.');
                    wp_redirect( wc_get_page_permalink( 'checkout' ) );
                    die();
                } else {
                    $wc_order->update_status( 'failed', 'Payment was declined by PayChangu.' );
                    wc_add_notice( 'Payment was declined by Paychangu.', 'error' );
                    // Add Admin Order Note
                    $wc_order->add_order_note('Payment was declined by PayChangu.');
                    wp_redirect( wc_get_page_permalink( 'checkout' ) );
                    die();
                }
            }
        }
        die();
    }

    /**
     * API page to redirect user to Paychangu
     */
    public function paychangu_proceed() {
        $invalid = 0;
		$order_id = sanitize_text_field($_GET['order_id']);
		$secret_key = sanitize_text_field($_GET['secret_key']);
		$callback_url = sanitize_url($_GET['callback_url']);
		$tx_ref = sanitize_text_field($_GET['tx_ref']);
		$amount = floatval(sanitize_text_field($_GET['amount']));
		$email = sanitize_email($_GET['email']);
		$first_name = sanitize_text_field($_GET['first_name']);
		$last_name = sanitize_text_field($_GET['last_name']);
		$title = sanitize_text_field($_GET['title']);
		$currency = sanitize_text_field($_GET['currency']);

		if (empty($order_id)) {
            wc_add_notice( 'It seems that something is wrong with your order. Please try again', 'error' );
            $invalid++;
        }
        if (empty($secret_key) || !wp_http_validate_url($callback_url)) {
            wc_add_notice( 'The payment setting of this website is not correct, please contact Administrator', 'error' );
            $invalid++;
        }
        if (empty($tx_ref)) {
            wc_add_notice( 'It seems that something is wrong with your order. Please try again', 'error' );
            $invalid++;
        }
        if (empty($amount) || !is_numeric($amount)) {
            wc_add_notice( 'It seems that you have submitted an invalid price for this order. Please try again', 'error' );
            $invalid++;
        }
        if (empty($email) || !is_email($email)){
            wc_add_notice( 'Your email is empty or not valid. Please check and try again', 'error' );
            $invalid++;
        }
        if (empty($first_name)) {
            wc_add_notice( 'Your first name is empty or not valid. Please check and try again', 'error' );
            $invalid++;
        }
        if (empty($last_name)) {
            wc_add_notice( 'Your last name is empty or not valid. Please check and try again', 'error' );
            $invalid++;
        }
		if (empty($title)) {
            wc_add_notice( 'The order title is empty or not valid. Please check and try again', 'error' );
            $invalid++;
        }
        if (empty($currency)) {
            wc_add_notice( 'The currency code is not valid. Please check and try again.', 'error' );
            $invalid++;
        }
        
		if ($invalid === 0) {
            $apiUrl = 'https://api.paychangu.com/payment';
			$apiResponse = wp_remote_post($apiUrl,
				[
					'method' => 'POST',
					'headers' => [
						'content-type' => 'application/json',
						'Authorization' => 'Bearer ' . $secret_key,
					],
					'body' => json_encode(array(
						"amount" => $amount,
						"currency" => $currency,
						"email" => $email,
						"first_name" => $first_name,
						"last_name" => $last_name,
						"callback_url" => $callback_url,
						"return_url" => wc_get_page_permalink('checkout'),
						"tx_ref" => $tx_ref,
						"customization" => array(
							"title" => $title,
							"description" => $title
						),
						"meta" => array(
							"uuid" => "uuid",
      						"response" => "Response",
							"redirect_to_url" => wc_get_page_permalink('checkout'),
							"order_id" => $order_id
						)
					))
				]
			);
			if (!is_wp_error($apiResponse)) {
				$apiBody = json_decode(wp_remote_retrieve_body($apiResponse));
				$external_url = $apiBody->data->checkout_url;
				if ($apiBody->status == 'success' && $external_url) {
					wp_redirect($external_url);
					die();
				} else {
					wc_add_notice( 'Payment was declined by PayChangu. Please check and try again', 'error' );
					wp_redirect(wc_get_page_permalink('checkout'));
					die();
				}
			} else {
                wc_add_notice( 'Payment was declined by PayChangu. Please check and try again', 'error' );
				wp_redirect(wc_get_page_permalink('checkout'));
				die();
			}
        }else{
            wp_redirect(wc_get_page_permalink('checkout'));
        }
        die();
    }

    /**
     * Handle PayChangu webhook.
     */
    public function handle_webhook() {
        /*
        * ---------------------------------------------------------
        * 1. Only allow POST requests
        * ---------------------------------------------------------
        */
        if ( $_SERVER['REQUEST_METHOD'] !== 'POST' ) {
            status_header( 405 );
            echo wp_json_encode(
                array(
                    'success' => false,
                    'message' => 'Method not allowed.',
                )
            );
            exit;
        }


        /*
        * ---------------------------------------------------------
        * 2. Get raw webhook payload
        * ---------------------------------------------------------
        */
        $payload = file_get_contents( 'php://input' );

        if ( empty( $payload ) ) {

            error_log( 'PayChangu webhook: Empty payload.' );

            status_header( 400 );
            echo wp_json_encode(
                array(
                    'success' => false,
                    'message' => 'Empty payload.',
                )
            );
            exit;
        }


        /*
        * ---------------------------------------------------------
        * 3. Get PayChangu Signature
        * ---------------------------------------------------------
        */
        $signature = isset( $_SERVER['HTTP_SIGNATURE'] )
            ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_SIGNATURE'] ) )
            : '';

        if ( empty( $signature ) ) {

            error_log( 'PayChangu webhook: Signature not found.' );

            status_header( 401 );
            echo wp_json_encode(
                array(
                    'success' => false,
                    'message' => 'Signature not found.',
                )
            );
            exit;
        }


        /*
        * ---------------------------------------------------------
        * 4. Check Webhook Secret
        * ---------------------------------------------------------
        */
        if ( empty( $this->webhook_secret ) ) {

            error_log( 'PayChangu webhook: Webhook secret is empty.' );

            status_header( 500 );
            echo wp_json_encode(
                array(
                    'success' => false,
                    'message' => 'Webhook secret is not configured.',
                )
            );
            exit;
        }


        /*
        * ---------------------------------------------------------
        * 5. Verify HMAC Signature
        *
        * PayChangu:
        * HMAC-SHA256(raw payload, Web Secret Key)
        * ---------------------------------------------------------
        */
        $expected_signature = hash_hmac(
            'sha256',
            $payload,
            $this->webhook_secret
        );

        if ( ! hash_equals( $expected_signature, $signature ) ) {

            error_log( 'PayChangu webhook: Invalid signature.' );

            status_header( 401 );
            echo wp_json_encode(
                array(
                    'success' => false,
                    'message' => 'Invalid signature.',
                )
            );
            exit;
        }


        /*
        * ---------------------------------------------------------
        * 6. Decode JSON
        * ---------------------------------------------------------
        */
        $webhook_data = json_decode( $payload, true );

        if ( ! is_array( $webhook_data ) ) {

            error_log( 'PayChangu webhook: Invalid JSON payload.' );

            status_header( 400 );
            echo wp_json_encode(
                array(
                    'success' => false,
                    'message' => 'Invalid JSON payload.',
                )
            );
            exit;
        }


        /*
        * ---------------------------------------------------------
        * 7. Get Event Type
        *
        * Your actual PayChangu webhook:
        *
        * checkout.payment
        * ---------------------------------------------------------
        */
        $event_type = isset( $webhook_data['event_type'] )
            ? sanitize_text_field( $webhook_data['event_type'] )
            : '';

        if ( $event_type !== 'checkout.payment' ) {

            error_log(
                'PayChangu webhook: Ignored event - ' . $event_type
            );

            /*
            * Return 200 because PayChangu does not need
            * to retry an event we intentionally don't process.
            */
            status_header( 200 );

            echo wp_json_encode(
                array(
                    'success' => true,
                    'message' => 'Event ignored.',
                )
            );
            exit;
        }


        /*
        * ---------------------------------------------------------
        * 8. Get Payment Information
        * ---------------------------------------------------------
        */

        $tx_ref = ! empty( $webhook_data['tx_ref'] )
            ? sanitize_text_field( $webhook_data['tx_ref'] )
            : '';

        $reference = ! empty( $webhook_data['reference'] )
            ? sanitize_text_field( $webhook_data['reference'] )
            : '';

        $status = ! empty( $webhook_data['status'] )
            ? strtolower(
                sanitize_text_field( $webhook_data['status'] )
            )
            : '';

        $currency = ! empty( $webhook_data['currency'] )
            ? strtoupper(
                sanitize_text_field( $webhook_data['currency'] )
            )
            : '';

        $amount = isset( $webhook_data['amount'] )
            ? (float) $webhook_data['amount']
            : 0;


        /*
        * Log basic information only.
        *
        * Avoid logging customer email/phone/card information.
        */
        error_log(
            sprintf(
                'PayChangu webhook received: tx_ref=%s, reference=%s, status=%s, amount=%s, currency=%s',
                $tx_ref,
                $reference,
                $status,
                $amount,
                $currency
            )
        );


        /*
        * ---------------------------------------------------------
        * 9. Transaction Reference is required
        * ---------------------------------------------------------
        */
        if ( empty( $tx_ref ) ) {

            error_log( 'PayChangu webhook: tx_ref is missing.' );

            status_header( 400 );
            echo wp_json_encode(
                array(
                    'success' => false,
                    'message' => 'Transaction reference is missing.',
                )
            );
            exit;
        }


        /*
        * ---------------------------------------------------------
        * 10. Get Order ID from meta
        *
        * Your actual payload contains:
        *
        * "meta":"{\"uuid\":\"uuid\",...,\"order_id\":\"30\"}"
        *
        * So meta is a JSON string.
        * ---------------------------------------------------------
        */
        $order_id = 0;

        if ( ! empty( $webhook_data['meta'] ) ) {

            $meta = json_decode(
                $webhook_data['meta'],
                true
            );

            if (
                is_array( $meta ) &&
                ! empty( $meta['order_id'] )
            ) {
                $order_id = absint( $meta['order_id'] );
            }
        }


        /*
        * ---------------------------------------------------------
        * 11. Fallback: Try to find order by transaction ID
        * ---------------------------------------------------------
        */
        if ( ! $order_id ) {

            $orders = wc_get_orders(
                array(
                    'limit'          => 1,
                    'transaction_id' => $tx_ref,
                    'return'         => 'objects',
                )
            );

            if ( ! empty( $orders ) ) {
                $order_id = $orders[0]->get_id();
            }
        }


        /*
        * ---------------------------------------------------------
        * 12. Order must exist
        * ---------------------------------------------------------
        */
        if ( ! $order_id ) {

            error_log(
                'PayChangu webhook: Order not found. tx_ref=' . $tx_ref
            );

            /*
            * Return 500 so PayChangu can retry.
            */
            status_header( 500 );

            echo wp_json_encode(
                array(
                    'success' => false,
                    'message' => 'WooCommerce order not found.',
                )
            );
            exit;
        }


        /*
        * ---------------------------------------------------------
        * 13. Get WooCommerce Order
        * ---------------------------------------------------------
        */
        $order = wc_get_order( $order_id );

        if ( ! $order ) {

            error_log(
                'PayChangu webhook: Invalid WooCommerce order ID ' .
                $order_id
            );

            status_header( 500 );

            echo wp_json_encode(
                array(
                    'success' => false,
                    'message' => 'Invalid WooCommerce order.',
                )
            );
            exit;
        }


        /*
        * ---------------------------------------------------------
        * 14. If already paid, don't process again
        * ---------------------------------------------------------
        */
        if ( $order->is_paid() ) {

            error_log(
                'PayChangu webhook: Order already paid. Order ID=' .
                $order_id
            );

            status_header( 200 );

            echo wp_json_encode(
                array(
                    'success' => true,
                    'message' => 'Order already paid.',
                )
            );
            exit;
        }

        /*
        * ---------------------------------------------------------
        * 15. Verify payment status
        * ---------------------------------------------------------
        */

        if ( $status !== 'success' ) {

            error_log(
                sprintf(
                    'PayChangu webhook: Payment not successful. Order=%d, tx_ref=%s, status=%s',
                    $order_id,
                    $tx_ref,
                    $status
                )
            );

            /*
            * Payment failed/cancelled.
            * Return 200 so PayChangu doesn't keep retrying.
            */
            status_header( 200 );

            echo wp_json_encode(
                array(
                    'success' => true,
                    'message' => 'Payment is not successful.',
                )
            );

            exit;
        }


        /*
        * ---------------------------------------------------------
        * 16. Verify currency
        * ---------------------------------------------------------
        */

        $order_currency = strtoupper(
            $order->get_currency()
        );

        if (
            ! empty( $currency ) &&
            $currency !== $order_currency
        ) {

            error_log(
                sprintf(
                    'PayChangu webhook: Currency mismatch. Order=%s, PayChangu=%s',
                    $order_currency,
                    $currency
                )
            );

            status_header( 400 );

            echo wp_json_encode(
                array(
                    'success' => false,
                    'message' => 'Currency mismatch.',
                )
            );

            exit;
        }


        /*
        * ---------------------------------------------------------
        * 17. Verify amount
        * ---------------------------------------------------------
        */

        $order_total = (float) $order->get_total();

        /*
        * PayChangu amount must be >= WooCommerce order total.
        */
        if ( $amount < $order_total ) {

            error_log(
                sprintf(
                    'PayChangu webhook: Amount mismatch. Order=%s, PayChangu=%s, Order ID=%d',
                    $order_total,
                    $amount,
                    $order_id
                )
            );

            status_header( 400 );

            echo wp_json_encode(
                array(
                    'success' => false,
                    'message' => 'Payment amount is insufficient.',
                )
            );

            exit;
        }


        /*
        * ---------------------------------------------------------
        * 18. Complete WooCommerce payment
        * ---------------------------------------------------------
        */

        $order->payment_complete( $tx_ref );


        /*
        * ---------------------------------------------------------
        * 19. Save PayChangu transaction information
        * ---------------------------------------------------------
        */

        $order->update_meta_data(
            '_paychangu_tx_ref',
            $tx_ref
        );

        if ( ! empty( $reference ) ) {

            $order->update_meta_data(
                '_paychangu_reference',
                $reference
            );
        }

        $order->update_meta_data(
            '_paychangu_webhook_verified',
            current_time( 'mysql' )
        );

        $order->add_order_note(
            sprintf(
                'PayChangu payment confirmed by webhook. Transaction reference: %s. Amount: %s %s.',
                $tx_ref,
                $amount,
                $order_currency
            )
        );

        $order->save();


        /*
        * ---------------------------------------------------------
        * 20. Log success
        * ---------------------------------------------------------
        */

        error_log(
            sprintf(
                'PayChangu webhook: Payment completed successfully. Order=%d, tx_ref=%s, amount=%s %s',
                $order_id,
                $tx_ref,
                $amount,
                $order_currency
            )
        );


        /*
        * ---------------------------------------------------------
        * 21. Return HTTP 200
        * ---------------------------------------------------------
        */

        status_header( 200 );

        echo wp_json_encode(
            array(
                'success' => true,
                'message' => 'Payment successfully processed.',
                'order_id' => $order_id,
                'tx_ref'   => $tx_ref,
            )
        );

        exit;
    }
	
    /**
     * Get the return url (thank you page).
     *
     * @param WC_Order|null $order Order object.
     * @return string
     */
    public function get_return_url( $order = null ) {
        if ( $order ) {
            $return_url = $order->get_checkout_order_received_url();
        } else {
            $return_url = wc_get_endpoint_url( 'order-received', '', wc_get_checkout_url() );
        }
        return apply_filters( 'woocommerce_get_return_url', $return_url, $order );
    }
}